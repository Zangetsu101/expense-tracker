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
const { homeListPage, homePace, homeDeckData, homeSearch, homeTrend, savePeriodSetting } =
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

const month = { range: 'month', monthStart: 1 };
const ids = (page) => page.periods.map(({ period, rows }) => [period.label, rows.map((r) => r.id)]);
/** Replaces all Transactions with six in January 2025, one in November 2024, and none in December. */
function seedList() {
  sqlite.exec(`DELETE FROM lending_entries; DELETE FROM people; DELETE FROM transactions;
    DELETE FROM categories WHERE id > 1`);
  add(1, 'EXPENSE', 12000, day(2025, 1, 3), 1);
  add(2, 'INCOME', 500, day(2025, 1, 4), 2);
  add(3, 'TRANSFER', 100, day(2025, 1, 5), 1, 0, 2);
  add(4, 'EXPENSE', 200, day(2025, 1, 5), 2, 1);
  add(5, 'EXPENSE', 900, day(2024, 11, 30), 2);
  add(6, 'EXPENSE', 900, day(2025, 1, 21), 1);
}
/** Adds a lending Transaction for Sam. */
function lend(id, kind, type) {
  sqlite.exec("INSERT OR IGNORE INTO people (id, name) VALUES (1, 'Sam')");
  add(id, type, 10000, day(2025, 1, 10), 1, 1);
  sqlite.prepare('UPDATE transactions SET categoryId = NULL WHERE id = ?').run(id);
  sqlite
    .prepare(
      'INSERT INTO lending_entries (personId, kind, transactionId, currencyCode, amountMinor, date) VALUES (1, ?, ?, ?, ?, ?)',
    )
    .run(kind, id, 'BDT', 10000, day(2025, 1, 10));
}

test('the list reads the range of the cards and says where older Transactions start', async () => {
  seedList();
  const today = day(2025, 1, 20);
  const page = await homeListPage(null, month, today, 0);
  assert.deepEqual(ids(page), [['January', [4, 3, 2, 1]]], 'a future Transaction does not show');
  assert.equal(page.firstDay, day(2024, 11, 30));
  assert.equal(page.next, 1);
  const transfer = page.periods[0].rows.find((row) => row.id === 3);
  assert.deepEqual(
    [transfer.accountName, transfer.transferAccountName, transfer.currencyCode],
    ['Cash', 'Bank', 'BDT'],
  );
  assert.equal(page.periods[0].rows.find((row) => row.id === 4).excludeFromReport, 1);
  const older = await homeListPage(null, month, today, 1);
  assert.deepEqual(ids(older), [['December 2024', []]], 'an empty older period still shows');
  assert.equal(older.next, 2);
  const oldest = await homeListPage(null, month, today, 2);
  assert.deepEqual(ids(oldest), [['November 2024', [5]]]);
  assert.equal(oldest.next, null, 'no Transactions are older');
});

test('an empty range of the cards also reads the period before it', async () => {
  seedList();
  const page = await homeListPage(null, month, day(2025, 2, 1), 0);
  assert.deepEqual(ids(page), [
    ['February', []],
    ['January', [6, 4, 3, 2, 1]],
  ]);
  assert.equal(page.next, 2);
  const none = await homeListPage(999, month, day(2025, 2, 1), 0);
  assert.deepEqual(none, {
    periods: [{ period: none.periods[0].period, rows: [] }],
    firstDay: null,
    next: null,
  });
});

test('Account scope includes either side of a Transfer', async () => {
  seedList();
  const today = day(2025, 1, 20);
  const bank = await homeListPage(2, month, today, 0);
  assert.deepEqual(ids(bank), [['January', [4, 3, 2]]]);
  const cash = await homeListPage(1, month, today, 0);
  assert.deepEqual(ids(cash), [['January', [3, 1]]]);
  assert.equal(cash.next, null);
});

test('a row has the emoji of its Category, or of the parent Category', async () => {
  seedList();
  sqlite.exec(`INSERT INTO categories (id, name, type, parentId, iconKey) VALUES
    (2, 'Eating out', 'EXPENSE', NULL, '🍽'), (3, 'Restaurants', 'EXPENSE', 2, NULL),
    (4, 'Cafes', 'EXPENSE', 2, '☕'), (5, 'Empty', 'EXPENSE', NULL, '')`);
  for (const [id, category] of [
    [20, 3],
    [21, 4],
    [22, 5],
  ]) {
    add(id, 'EXPENSE', 100, day(2025, 1, 6), 1);
    sqlite.prepare('UPDATE transactions SET categoryId = ? WHERE id = ?').run(category, id);
  }
  const rows = (await homeListPage(1, month, day(2025, 1, 20), 0)).periods[0].rows;
  const row = (id) => rows.find((r) => r.id === id);
  assert.deepEqual(
    [row(20).categoryIcon, row(20).categoryName, row(20).parentCategoryName],
    ['🍽', 'Restaurants', 'Eating out'],
  );
  assert.equal(row(21).categoryIcon, '☕');
  assert.equal(row(22).categoryIcon, null, 'an empty emoji is no emoji');
  assert.equal(row(1).categoryIcon, null);
});

test('the list joins all lending kinds to saved people without duplicating ordinary rows or changing reports', async () => {
  seedList();
  const read = async () => (await homeListPage(null, month, day(2025, 1, 20), 0)).periods[0].rows;
  const before = await read();
  const paceBefore = await homePace(null, january);
  const movements = [
    ['LEND', 'EXPENSE', 'Lent to Sam'],
    ['BORROW', 'INCOME', 'Borrowed from Sam'],
    ['RECEIVE_REPAYMENT', 'INCOME', 'Repayment from Sam'],
    ['REPAY', 'EXPENSE', 'Repaid to Sam'],
  ];
  for (const [index, [kind, type]] of movements.entries()) lend(10 + index, kind, type);
  const after = await read();
  assert.deepEqual(await homePace(null, january), paceBefore, 'lending stays out of Pace');
  assert.equal(after.length, before.length + 4);
  assert.deepEqual(
    after.filter((row) => row.id >= 10).map(transactionTitle),
    movements.toReversed().map((movement) => movement[2]),
  );
  assert.equal(after.find((row) => row.id === 1).lendingKind, null);
});

test('search on all dates matches the note, the Categories, the Accounts and the person', async () => {
  seedList();
  lend(10, 'LEND', 'EXPENSE');
  sqlite.prepare("UPDATE transactions SET note = 'Lunch 100% with Rahim' WHERE id = 1").run();
  const found = async (accountId, query) =>
    (await homeSearch(accountId, query)).map((row) => row.id);
  assert.deepEqual(await found(null, ' rahim '), [1]);
  assert.deepEqual(await found(null, '100%'), [1]);
  assert.deepEqual(await found(null, '%'), [1], 'a % in the search is a plain character');
  assert.deepEqual(await found(null, 'food'), [6, 4, 1, 5], 'the Category');
  assert.deepEqual(await found(2, 'cash'), [3], 'the other side of a Transfer');
  assert.deepEqual(await found(null, 'sam'), [10]);
  assert.deepEqual(await found(1, 'bank'), [3]);
  assert.deepEqual(await found(2, 'rahim'), []);
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
