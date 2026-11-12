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
globalThis.__homeSqliteAdapter = adapter;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/lib/'))
      return {
        url: new URL(`../../lib/${specifier.slice(6)}.ts`, import.meta.url).href,
        shortCircuit: true,
      };
    if (specifier === 'expo-sqlite') return { url: 'test:sqlite', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:sqlite')
      return {
        format: 'module',
        source: 'export const openDatabaseAsync = async () => globalThis.__homeSqliteAdapter;',
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
const { database, epochDay } = await import('../../lib/database.ts');
const { homeData, homePace, homeDeckData, homeTrend, savePeriodSetting } =
  await import('./read-home.ts');
const { transactionTitle } = await import('../../lib/transaction-format.ts');
await database();
sqlite.exec(`DELETE FROM transactions; DELETE FROM categories; DELETE FROM accounts;
  INSERT INTO accounts (id, name, currencyCode) VALUES (1, 'Cash', 'BDT'), (2, 'Bank', 'USD');
  INSERT INTO categories (id, name, type) VALUES (1, 'Food', 'EXPENSE');`);
const day = (year, month, date) => epochDay(new Date(year, month - 1, date));
const january = {
  start: day(2025, 1, 1),
  end: day(2025, 1, 21),
  previousStart: day(2024, 12, 1),
  previousSameEnd: day(2024, 12, 21),
};
const add = (id, type, amount, date, account, excluded = 0, destination = null) =>
  sqlite
    .prepare(
      `INSERT INTO transactions (id, type, amountMinor, date, accountId, categoryId, excludeFromReport, transferAccountId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, type, amount, date, account, type === 'EXPENSE' ? 1 : null, excluded, destination);

test('Home reads recent activity and keeps reportable monthly totals separate by Currency', async () => {
  add(1, 'EXPENSE', 12000, day(2025, 1, 3), 1);
  add(2, 'INCOME', 500, day(2025, 1, 4), 2);
  add(3, 'TRANSFER', 100, day(2025, 1, 5), 1, 0, 1);
  add(4, 'EXPENSE', 200, day(2025, 1, 6), 2, 1);
  add(5, 'EXPENSE', 900, day(2024, 12, 31), 2);
  const result = await homeData();
  assert.deepEqual(
    result.rows.map(({ id, currencyCode, transferAccountName }) => ({
      id,
      currencyCode,
      transferAccountName,
    })),
    [
      { id: 4, currencyCode: 'USD', transferAccountName: null },
      { id: 3, currencyCode: 'BDT', transferAccountName: 'Cash' },
      { id: 2, currencyCode: 'USD', transferAccountName: null },
      { id: 1, currencyCode: 'BDT', transferAccountName: null },
      { id: 5, currencyCode: 'USD', transferAccountName: null },
    ],
  );
});

test('Home joins all lending kinds to saved people without duplicating ordinary rows or changing reports', async () => {
  const before = await homeData();
  const paceBefore = await homePace(null, january);
  sqlite.exec("INSERT INTO people (id, name) VALUES (1, 'Sam')");
  const movements = [
    ['LEND', 'EXPENSE', 'Lent to Sam'],
    ['BORROW', 'INCOME', 'Borrowed from Sam'],
    ['RECEIVE_REPAYMENT', 'INCOME', 'Repayment from Sam'],
    ['REPAY', 'EXPENSE', 'Repaid to Sam'],
  ];
  for (const [index, [kind, type]] of movements.entries()) {
    const id = 10 + index;
    add(id, type, 10000, day(2025, 1, 10), 1, 1);
    sqlite.prepare('UPDATE transactions SET categoryId = NULL WHERE id = ?').run(id);
    sqlite
      .prepare(
        'INSERT INTO lending_entries (personId, kind, transactionId, currencyCode, amountMinor, date) VALUES (1, ?, ?, ?, ?, ?)',
      )
      .run(kind, id, 'BDT', 10000, day(2025, 1, 10));
  }
  const after = await homeData();
  assert.deepEqual(await homePace(null, january), paceBefore, 'lending stays out of Pace');
  assert.equal(after.rows.length, before.rows.length + 4);
  assert.deepEqual(
    after.rows.filter((row) => row.id >= 10).map(transactionTitle),
    movements.toReversed().map((movement) => movement[2]),
  );
  assert.equal(after.rows.find((row) => row.id === 1).lendingKind, null);
});

test('Account scope includes either Transfer side and filters activity before the 50-row limit', async () => {
  sqlite.exec("INSERT INTO accounts (id, name, currencyCode) VALUES (3, 'Mobile', 'BDT')");
  add(100, 'TRANSFER', 4000, day(2025, 1, 12), 1, 0, 3);
  add(101, 'EXPENSE', 300, day(2025, 1, 13), 3);
  add(102, 'INCOME', 700, day(2025, 1, 14), 3);
  add(103, 'EXPENSE', 999, day(2025, 1, 15), 3, 1);
  for (let id = 200; id < 255; id++) add(id, 'EXPENSE', 10, day(2025, 1, 16), 2);
  const mobile = await homeData(3);
  assert.deepEqual(
    mobile.rows.map((row) => row.id),
    [103, 102, 101, 100],
  );
  assert.equal(mobile.rows.at(-1).accountId, 1);
  assert.equal(mobile.rows.at(-1).transferAccountId, 3);
  const cash = await homeData(1);
  assert.ok(cash.rows.some((row) => row.id === 100));
  assert.ok(cash.rows.every((row) => row.accountId === 1 || row.transferAccountId === 1));
  assert.deepEqual(
    mobile.dailySummaries.find((summary) => summary.date === day(2025, 1, 13)),
    { date: day(2025, 1, 13), currencyCode: 'BDT', incomeMinor: 0, expenseMinor: 300 },
  );
  const empty = await homeData(999);
  assert.deepEqual(empty, { rows: [], dailySummaries: [] });
});

test('All accounts keeps each Transfer once', async () => {
  const result = await homeData();
  assert.equal(result.rows.length, 50);
  const earlier = await homeData(3);
  assert.equal(earlier.rows.filter((row) => row.id === 100).length, 1);
  sqlite.exec('DELETE FROM transactions WHERE id >= 200');
  const all = await homeData();
  assert.equal(all.rows.filter((row) => row.id === 100).length, 1);
});

test('daily totals include the whole day beyond the activity limit, separate currencies and omit transfers', async () => {
  const date = day(2026, 1, 1);
  for (let id = 300; id < 355; id++) add(id, 'EXPENSE', 100, date, 1);
  add(355, 'INCOME', 800, date, 1);
  add(356, 'EXPENSE', 200, date, 1, 1);
  add(357, 'INCOME', 300, date, 2);
  add(358, 'TRANSFER', 999, date, 1, 0, 1);
  const scoped = await homeData(1);
  assert.deepEqual(scoped.dailySummaries[0], {
    date,
    currencyCode: 'BDT',
    incomeMinor: 800,
    expenseMinor: 5700,
  });
  assert.ok(scoped.dailySummaries.every((summary) => summary.currencyCode === 'BDT'));
  const result = await homeData();
  assert.equal(result.rows.length, 50);
  assert.deepEqual(result.dailySummaries, [
    { date, currencyCode: 'BDT', incomeMinor: 800, expenseMinor: 5700 },
    { date, currencyCode: 'USD', incomeMinor: 300, expenseMinor: 0 },
  ]);
});

test('the deck read gives balances as of today, the last day of use, and saved settings', async () => {
  sqlite.exec(`DELETE FROM transactions; DELETE FROM lending_entries; DELETE FROM app_settings;
    DELETE FROM accounts;
    INSERT INTO accounts (id, name, currencyCode, openingBalanceMinor, isFavorite)
    VALUES (1, 'Cash', 'BDT', 1000, 1), (2, 'Bank', 'BDT', 0, 0), (3, 'Wise', 'USD', 500, 0);`);
  add(1, 'EXPENSE', 200, day(2026, 11, 2), 1);
  add(2, 'TRANSFER', 300, day(2026, 11, 5), 2, 0, 1);
  add(3, 'INCOME', 900, day(2026, 11, 20), 2);
  const today = day(2026, 11, 9);
  const deck = await homeDeckData(today);
  assert.deepEqual(
    deck.accounts.map(({ id, balanceMinor, lastUsedDay }) => [id, balanceMinor, lastUsedDay]),
    [
      [2, -300, day(2026, 11, 5)],
      [1, 1100, day(2026, 11, 5)],
      [3, 500, null],
    ],
    'a future Transaction counts for neither the balance nor the last day of use',
  );
  assert.deepEqual(deck.period, { range: 'month', monthStart: 1 });
  assert.equal(deck.displayRate, null);
  await savePeriodSetting({ range: 'week', monthStart: 25 });
  sqlite.exec(`INSERT INTO app_settings (key, value) VALUES ('backupSettings',
    '{"favoriteAccountId":1,"displayRate":{"base":"USD","quote":"BDT","rate":120}}')`);
  const saved = await homeDeckData(today);
  assert.deepEqual(saved.period, { range: 'week', monthStart: 25 });
  assert.deepEqual(saved.displayRate, { base: 'USD', quote: 'BDT', rate: 120 });
});

test('the trend read gives the end-of-day balance from the day before the period to today', async () => {
  // Cash opens at 1000, -200 on the 2nd, +300 on the 5th, and a future Income on the 20th.
  const start = day(2026, 11, 1);
  const today = day(2026, 11, 6);
  assert.deepEqual(await homeTrend(1, start, today), [1000, 1000, 800, 800, 800, 1100, 1100]);
  assert.deepEqual(await homeTrend(2, day(2026, 11, 4), today), [0, 0, -300, -300]);
  assert.deepEqual(await homeTrend(1, day(2026, 11, 3), today), [800, 800, 800, 1100, 1100]);
});

test('Pace sums reportable Expenses for each Currency in three windows', async () => {
  sqlite.exec('DELETE FROM transactions');
  add(1, 'EXPENSE', 100, day(2026, 11, 3), 1);
  add(2, 'EXPENSE', 40, day(2026, 10, 2), 1);
  add(3, 'EXPENSE', 60, day(2026, 10, 20), 2);
  add(4, 'EXPENSE', 7, day(2026, 11, 4), 3);
  add(5, 'EXPENSE', 999, day(2026, 11, 4), 1, 1);
  add(6, 'INCOME', 999, day(2026, 11, 4), 1);
  add(7, 'TRANSFER', 999, day(2026, 11, 4), 2, 0, 1);
  add(8, 'EXPENSE', 999, day(2026, 9, 30), 1);
  add(9, 'EXPENSE', 999, day(2026, 11, 10), 1);
  const period = {
    start: day(2026, 11, 1),
    end: day(2026, 11, 10),
    previousStart: day(2026, 10, 1),
    previousSameEnd: day(2026, 10, 10),
  };
  assert.deepEqual(await homePace(null, period), [
    { currencyCode: 'BDT', spentMinor: 100, sameMinor: 40, previousMinor: 100 },
    { currencyCode: 'USD', spentMinor: 7, sameMinor: 0, previousMinor: 0 },
  ]);
  assert.deepEqual(await homePace(2, period), [
    { currencyCode: 'BDT', spentMinor: 0, sameMinor: 0, previousMinor: 60 },
  ]);
  assert.deepEqual(await homePace(3, { ...period, previousStart: day(2026, 12, 1) }), [
    { currencyCode: 'USD', spentMinor: 7, sameMinor: 0, previousMinor: 0 },
  ]);
});
