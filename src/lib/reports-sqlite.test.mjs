import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sqlite = new DatabaseSync(':memory:');
const adapter = {
  execAsync: async (sql) => sqlite.exec(sql),
  runAsync: async (sql, params = []) => sqlite.prepare(sql).run(...params),
  getAllAsync: async (sql, params = []) =>
    sqlite
      .prepare(sql)
      .all(...params)
      .map((row) => ({ ...row })),
  getFirstAsync: async (sql, params = []) => sqlite.prepare(sql).get(...params) ?? null,
};
globalThis.__reportsSqliteAdapter = adapter;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/database' || specifier === './database')
      return { url: new URL('./database.ts', import.meta.url).href, shortCircuit: true };
    if (specifier === 'expo-sqlite') return { url: 'test:sqlite', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:sqlite')
      return {
        format: 'module',
        source: 'export const openDatabaseAsync = async () => globalThis.__reportsSqliteAdapter;',
        shortCircuit: true,
      };
    if (url.endsWith('.ts')) {
      const loaded = next(url, { ...context, format: 'module' });
      return {
        ...loaded,
        format: 'module',
        source: stripTypeScriptTypes(loaded.source.toString()),
      };
    }
    return next(url, context);
  },
});
const { database, epochDay } = await import('./database.ts');
const { accountBalances, rangeReport, spendDays } = await import('./reports.ts');
// setUTCFullYear keeps years 1–99, unlike the Date constructor with many arguments.
const monthRange = (year, month) => {
  const boundary = new Date(0);
  boundary.setUTCFullYear(year, month - 1, 1);
  const start = boundary.getTime() / 86400000;
  boundary.setUTCFullYear(year, month, 1);
  return [start, boundary.getTime() / 86400000];
};
const monthlyReport = (year, month, ...account) =>
  rangeReport(...monthRange(year, month), ...account);
const { combinedMinor, combinedCategorySpending } = await import('./display-rate.ts');
await database();
sqlite.exec(`DELETE FROM transactions; DELETE FROM categories; DELETE FROM accounts;
  INSERT INTO accounts (id, name, currencyCode, openingBalanceMinor) VALUES
    (1, 'Cash', 'USD', 1000), (2, 'Bank', 'USD', -200), (3, 'Wallet', 'BDT', 5000), (4, 'Empty', 'EUR', 75);
  INSERT INTO categories (id, name, type) VALUES (1, 'Food', 'EXPENSE'), (2, 'Salary', 'INCOME'), (3, 'Rent', 'EXPENSE');`);
const day = (year, month, date) => epochDay(new Date(year, month - 1, date));
const add = (
  id,
  type,
  amount,
  date,
  accountId,
  categoryId = null,
  excluded = 0,
  transferAccountId = null,
) =>
  sqlite
    .prepare(
      `INSERT INTO transactions (id, type, amountMinor, date, accountId, categoryId, excludeFromReport, transferAccountId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, type, amount, date, accountId, categoryId, excluded, transferAccountId);

add(1, 'EXPENSE', 100, day(2025, 1, 1), 1, 1);
sqlite
  .prepare("INSERT INTO line_items (transactionId, name, amountMinor) VALUES (1, 'Partial', 25)")
  .run();
add(2, 'EXPENSE', 50, day(2025, 1, 31), 1, null);
add(3, 'INCOME', 400, day(2025, 1, 15), 1, 2);
add(4, 'TRANSFER', 250, day(2025, 1, 15), 1, null, 0, 2);
add(5, 'TRANSFER', 30, day(2025, 1, 15), 2, null, 1, 1);
add(6, 'EXPENSE', 20, day(2025, 1, 10), 1, 1, 1);
add(7, 'INCOME', 60, day(2025, 1, 10), 1, 2, 1);
add(8, 'EXPENSE', 10000, day(2025, 1, 5), 3, 1);
add(9, 'EXPENSE', 5000, day(2025, 1, 6), 3, 3);
add(10, 'INCOME', 20000, day(2025, 1, 7), 3, 2);
add(11, 'EXPENSE', 10, day(2024, 12, 31), 1, 1);
add(12, 'EXPENSE', 15, day(2025, 2, 1), 1, 1);

test('balances include opening amounts and both transfer legs, even for excluded transactions', async () => {
  assert.deepEqual(await accountBalances(day(2025, 2, 1)), [
    { id: 2, name: 'Bank', currencyCode: 'USD', balanceMinor: 20 },
    { id: 1, name: 'Cash', currencyCode: 'USD', balanceMinor: 1045 },
    { id: 4, name: 'Empty', currencyCode: 'EUR', balanceMinor: 75 },
    { id: 3, name: 'Wallet', currencyCode: 'BDT', balanceMinor: 10000 },
  ]);
});

test('balances include today and omit future Expenses, Income and both Transfer legs', async () => {
  const today = day(2025, 2, 1);
  const baseline = await accountBalances(today);
  try {
    add(80, 'EXPENSE', 101, today + 1, 1, 1);
    add(81, 'INCOME', 203, today + 1, 2, 2);
    add(82, 'TRANSFER', 307, today + 1, 1, null, 0, 2);
    add(83, 'TRANSFER', 409, today + 1, 2, null, 0, 1);
    add(84, 'EXPENSE', 503, today + 1, 4);
    assert.deepEqual(await accountBalances(today), baseline);
    assert.deepEqual(
      await accountBalances(today + 1),
      baseline.map((row) => ({
        ...row,
        balanceMinor: row.balanceMinor + ({ 1: 1, 2: 101, 4: -503 }[row.id] ?? 0),
      })),
    );
  } finally {
    sqlite.prepare('DELETE FROM transactions WHERE id BETWEEN 80 AND 84').run();
  }
});

test('default balance cutoff follows the local date across midnight in different timezones', async (t) => {
  const original = process.env.TZ;
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2025-02-01T01:00:00Z') });
  try {
    for (const [zone, cutoff, cashBalance] of [
      ['America/Los_Angeles', day(2025, 1, 31), 1060],
      ['Asia/Dhaka', day(2025, 2, 1), 1045],
    ]) {
      process.env.TZ = zone;
      const balances = await accountBalances();
      assert.deepEqual(balances, await accountBalances(cutoff), zone);
      assert.equal(balances.find((row) => row.id === 1).balanceMinor, cashBalance, zone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
    t.mock.timers.reset();
  }
});

test('range reports separate currencies, income and spending, omit excluded rows and transfers, and keep null categories', async () => {
  assert.deepEqual(await monthlyReport(2025, 1), {
    spending: [
      {
        categoryId: 1,
        categoryName: 'Food',
        topId: 1,
        topName: 'Food',
        currencyCode: 'BDT',
        amountMinor: 10000,
      },
      {
        categoryId: 3,
        categoryName: 'Rent',
        topId: 3,
        topName: 'Rent',
        currencyCode: 'BDT',
        amountMinor: 5000,
      },
      {
        categoryId: 1,
        categoryName: 'Food',
        topId: 1,
        topName: 'Food',
        currencyCode: 'USD',
        amountMinor: 100,
      },
      {
        categoryId: null,
        categoryName: null,
        topId: null,
        topName: null,
        currencyCode: 'USD',
        amountMinor: 50,
      },
    ],
    summaries: [
      { currencyCode: 'BDT', incomeMinor: 20000, expenseMinor: 15000 },
      { currencyCode: 'USD', incomeMinor: 400, expenseMinor: 150 },
    ],
  });
  assert.deepEqual(await monthlyReport(2024, 12), {
    spending: [
      {
        categoryId: 1,
        categoryName: 'Food',
        topId: 1,
        topName: 'Food',
        currencyCode: 'USD',
        amountMinor: 10,
      },
    ],
    summaries: [{ currencyCode: 'USD', incomeMinor: 0, expenseMinor: 10 }],
  });
  assert.deepEqual(await monthlyReport(2025, 2), {
    spending: [
      {
        categoryId: 1,
        categoryName: 'Food',
        topId: 1,
        topName: 'Food',
        currencyCode: 'USD',
        amountMinor: 15,
      },
    ],
    summaries: [{ currencyCode: 'USD', incomeMinor: 0, expenseMinor: 15 }],
  });
  assert.deepEqual(await monthlyReport(2025, 3), { spending: [], summaries: [] });
});

test('range reports scope both totals to one Account, excluding transfers and excluded Transactions', async () => {
  assert.deepEqual(await monthlyReport(2025, 1, 1), {
    spending: [
      {
        categoryId: 1,
        categoryName: 'Food',
        topId: 1,
        topName: 'Food',
        currencyCode: 'USD',
        amountMinor: 100,
      },
      {
        categoryId: null,
        categoryName: null,
        topId: null,
        topName: null,
        currencyCode: 'USD',
        amountMinor: 50,
      },
    ],
    summaries: [{ currencyCode: 'USD', incomeMinor: 400, expenseMinor: 150 }],
  });
  for (const accountId of [2, 4, 999]) {
    assert.deepEqual(await monthlyReport(2025, 1, accountId), { spending: [], summaries: [] });
  }
});

test('Account scope does not combine another Account using the same Currency', async () => {
  try {
    add(90, 'EXPENSE', 700, day(2025, 1, 15), 2, 1);
    add(91, 'INCOME', 900, day(2025, 1, 15), 2, 2);
    assert.deepEqual(await monthlyReport(2025, 1, 2), {
      spending: [
        {
          categoryId: 1,
          categoryName: 'Food',
          topId: 1,
          topName: 'Food',
          currencyCode: 'USD',
          amountMinor: 700,
        },
      ],
      summaries: [{ currencyCode: 'USD', incomeMinor: 900, expenseMinor: 700 }],
    });
  } finally {
    sqlite.prepare('DELETE FROM transactions WHERE id IN (90, 91)').run();
  }
});

test('calendar months include leap days and December rollover, including years 1–99', async () => {
  // ISO dates provide an independent epoch-day fixture without JS year-1900 coercion.
  const isoDay = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;
  const fixtures = [
    [100, '0001-01-01', 11],
    [101, '0099-12-31', 12],
    [102, '0100-01-01', 13],
    [103, '2024-02-29', 14],
    [104, '2024-03-01', 15],
  ];
  try {
    for (const [id, iso, amount] of fixtures) add(id, 'EXPENSE', amount, isoDay(iso), 1, 1);
    for (const [year, month, amount] of [
      [1, 1, 11],
      [99, 12, 12],
      [100, 1, 13],
      [2024, 2, 14],
      [2024, 3, 15],
    ]) {
      assert.deepEqual(await monthlyReport(year, month, 1), {
        spending: [
          {
            categoryId: 1,
            categoryName: 'Food',
            topId: 1,
            topName: 'Food',
            currencyCode: 'USD',
            amountMinor: amount,
          },
        ],
        summaries: [{ currencyCode: 'USD', incomeMinor: 0, expenseMinor: amount }],
      });
    }
  } finally {
    sqlite.prepare('DELETE FROM transactions WHERE id >= 100').run();
  }
});

test('range reports reject invalid ranges and Account identifiers', async () => {
  for (const [start, end] of [
    [10, 10],
    [11, 10],
    [1.5, 10],
    [NaN, 10],
    [0, Infinity],
  ]) {
    await assert.rejects(rangeReport(start, end), /Invalid range/);
  }
  for (const accountId of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '1']) {
    await assert.rejects(monthlyReport(2025, 1, accountId), /Invalid account/);
  }
  assert.deepEqual(await monthlyReport(9999, 12, 1), { spending: [], summaries: [] });
  assert.deepEqual(await monthlyReport(2025, 1, Number.MAX_SAFE_INTEGER), {
    spending: [],
    summaries: [],
  });
});

test('range reports give each Category the Category at the top of its tree', async () => {
  try {
    sqlite.exec(`INSERT INTO categories (id, name, type, parentId) VALUES
      (40, 'Groceries', 'EXPENSE', 1), (41, 'Fruit', 'EXPENSE', 40),
      (42, 'Loop A', 'EXPENSE', 43), (43, 'Loop B', 'EXPENSE', 42)`);
    add(110, 'EXPENSE', 30, day(2025, 3, 2), 1, 40);
    add(111, 'EXPENSE', 20, day(2025, 3, 3), 1, 41);
    add(112, 'EXPENSE', 5, day(2025, 3, 4), 1, 42);
    add(113, 'EXPENSE', 7, day(2025, 3, 31), 1, 1);
    const { spending } = await rangeReport(day(2025, 3, 2), day(2025, 4, 1));
    assert.deepEqual(
      spending.map((row) => [row.categoryName, row.topId, row.topName, row.amountMinor]),
      [
        ['Groceries', 1, 'Food', 30],
        ['Fruit', 1, 'Food', 20],
        ['Food', 1, 'Food', 7],
        ['Loop A', 42, 'Loop A', 5],
      ],
    );
    const firstDay = await rangeReport(day(2025, 3, 2), day(2025, 3, 3));
    assert.deepEqual(
      firstDay.spending.map((row) => row.amountMinor),
      [30],
    );
  } finally {
    sqlite.exec('DELETE FROM transactions WHERE id >= 110; DELETE FROM categories WHERE id >= 40');
  }
});

test('range report boundaries do not shift with the local timezone', async () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Dhaka', 'Pacific/Kiritimati']) {
      process.env.TZ = zone;
      assert.deepEqual(
        await monthlyReport(2025, 1, 1),
        {
          spending: [
            {
              categoryId: 1,
              categoryName: 'Food',
              topId: 1,
              topName: 'Food',
              currencyCode: 'USD',
              amountMinor: 100,
            },
            {
              categoryId: null,
              categoryName: null,
              topId: null,
              topName: null,
              currencyCode: 'USD',
              amountMinor: 50,
            },
          ],
          summaries: [{ currencyCode: 'USD', incomeMinor: 400, expenseMinor: 150 }],
        },
        zone,
      );
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('display rate combines SQLite report totals without altering per-currency amounts', async () => {
  const { spending, summaries } = await monthlyReport(2025, 1);
  const rate = { base: 'USD', quote: 'BDT', rate: 100 };
  assert.equal(
    combinedMinor(
      summaries.map(({ currencyCode, incomeMinor }) => ({
        currencyCode,
        amountMinor: incomeMinor,
      })),
      rate,
    ),
    600,
  );
  assert.equal(
    combinedMinor(
      summaries.map(({ currencyCode, expenseMinor }) => ({
        currencyCode,
        amountMinor: expenseMinor,
      })),
      rate,
    ),
    300,
  );
  assert.deepEqual(combinedCategorySpending(spending, rate), [
    { categoryId: 1, categoryName: 'Food', amountMinor: 200 },
    { categoryId: 3, categoryName: 'Rent', amountMinor: 50 },
    { categoryId: null, categoryName: null, amountMinor: 50 },
  ]);
  assert.equal(
    combinedMinor(
      summaries.map(({ currencyCode, expenseMinor }) => ({
        currencyCode,
        amountMinor: expenseMinor,
      })),
      null,
    ),
    null,
  );
  assert.deepEqual(combinedCategorySpending(spending, null), []);
});

test('linked money lowers the original category in the month it arrived', async () => {
  add(910, 'EXPENSE', 30000, day(2025, 10, 31), 1, 1);
  add(911, 'INCOME', 7000, day(2025, 11, 1), 2);
  add(912, 'INCOME', 10000, day(2025, 11, 2), 2, 2);
  sqlite.exec('INSERT INTO reimbursements (transactionId, expenseId) VALUES (911, 910)');
  const october = await monthlyReport(2025, 10);
  const november = await monthlyReport(2025, 11);
  assert.equal(october.spending.find((row) => row.categoryId === 1).amountMinor, 30000);
  assert.equal(november.spending.find((row) => row.categoryId === 1).amountMinor, -7000);
  assert.deepEqual(november.summaries, [
    { currencyCode: 'USD', incomeMinor: 10000, expenseMinor: -7000 },
  ]);
  assert.equal((await spendDays(null, ...monthRange(2025, 11)))[0].amountMinor, -7000);
  const { searchStatement } = await import('./transaction-search.ts');
  const { sql, params } = searchStatement({
    query: 'food',
    type: 'EXPENSE',
    categoryId: 1,
    accountId: 2,
    month: '2025-11',
    reportSpending: true,
  });
  const matches = sqlite.prepare(sql).all(...params);
  assert.deepEqual(
    matches.map((row) => [row.id, row.categoryPath, row.reimbursementExpenseId]),
    [[911, 'Food', 910]],
  );
});
