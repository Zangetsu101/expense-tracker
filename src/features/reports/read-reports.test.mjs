import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sqlite = new DatabaseSync(':memory:');
globalThis.__reportsReadAdapter = {
  execAsync: async (sql) => sqlite.exec(sql),
  runAsync: async (sql, params = []) => sqlite.prepare(sql).run(...params),
  getAllAsync: async (sql, params = []) =>
    sqlite
      .prepare(sql)
      .all(...params)
      .map((row) => ({ ...row })),
  getFirstAsync: async (sql, params = []) => sqlite.prepare(sql).get(...params) ?? null,
};
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
        source: 'export const openDatabaseAsync = async () => globalThis.__reportsReadAdapter;',
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
const { database } = await import('../../lib/database.ts');
const { netWorthData, reportSettings, saveFiscalStart } = await import('./read-reports.ts');
const { spendDays } = await import('../../lib/reports.ts');
await database();
const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const today = day(2026, 11, 13);
sqlite.exec(`DELETE FROM transactions; DELETE FROM categories; DELETE FROM accounts;
  DELETE FROM app_settings;
  INSERT INTO accounts (id, name, currencyCode, openingBalanceMinor, isFavorite) VALUES
    (1, 'Cash', 'BDT', 1000, 0), (2, 'Wise', 'USD', 50, 1);
  INSERT INTO categories (id, name, type, parentId) VALUES
    (1, 'Food', 'EXPENSE', NULL), (2, 'Coffee', 'EXPENSE', 1);
  INSERT INTO people (id, name) VALUES (1, 'Rafi');`);
const add = (id, type, amount, date, accountId, categoryId = null, extra = {}) =>
  sqlite
    .prepare(
      `INSERT INTO transactions (id, type, amountMinor, date, accountId, categoryId, excludeFromReport, transferAccountId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, type, amount, date, accountId, categoryId, extra.excluded ?? 0, extra.to ?? null);

add(1, 'EXPENSE', 100, day(2026, 10, 5), 1, 2);
add(2, 'EXPENSE', 30, day(2026, 10, 5), 1, 2);
add(3, 'EXPENSE', 70, day(2026, 10, 6), 1, 1);
add(4, 'EXPENSE', 9, day(2026, 10, 6), 1, 1, { excluded: 1 });
add(5, 'EXPENSE', 5, day(2026, 10, 7), 2, null);
add(6, 'INCOME', 500, day(2026, 9, 1), 1);
add(7, 'TRANSFER', 200, day(2026, 11, 2), 1, null, { to: 2 });
add(8, 'EXPENSE', 40, day(2026, 11, 20), 1, 1);
add(9, 'EXPENSE', 60, day(2026, 11, 3), 1, null);
sqlite.exec(`INSERT INTO lending_entries (personId, kind, transactionId, currencyCode, amountMinor, date)
  VALUES (1, 'LEND', 9, 'BDT', 60, ${day(2026, 11, 3)}),
  (1, 'WRITE_OFF_LENT', NULL, 'BDT', 10, ${day(2026, 11, 4)}),
  (1, 'WRITE_OFF_LENT', NULL, 'BDT', 1, ${day(2026, 11, 30)})`);

test('spendDays groups reportable Expenses by day and Category, with the top Category', async () => {
  const rows = await spendDays(null, day(2026, 10, 1), day(2026, 11, 1));
  const sorted = rows
    .map((r) => [r.currencyCode, r.categoryName, r.topName, r.date, r.amountMinor])
    .sort((a, b) => a[3] - b[3] || String(a[1]).localeCompare(String(b[1])));
  assert.deepEqual(sorted, [
    ['BDT', 'Coffee', 'Food', day(2026, 10, 5), 130],
    ['BDT', 'Food', 'Food', day(2026, 10, 6), 70],
    ['USD', null, null, day(2026, 10, 7), 5],
  ]);
  assert.equal((await spendDays(2, day(2026, 10, 1), day(2026, 11, 1))).length, 1);
});

test('netWorthData reads month changes up to today and the lending as it happened', async () => {
  const data = await netWorthData(null, today);
  assert.equal(data.mainCurrency, 'USD', 'the favorite Account sets the main Currency');
  assert.deepEqual(
    data.accounts.map((a) => a.name),
    ['Cash', 'Wise'],
  );
  const month = (y, m) => y * 12 + m - 1;
  assert.deepEqual(
    data.changes
      .map((c) => [c.accountId, c.month, c.changeMinor])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    [
      [1, month(2026, 9), 500],
      [1, month(2026, 10), -209],
      [1, month(2026, 11), -260],
      [2, month(2026, 10), -5],
      [2, month(2026, 11), 200],
    ],
  );
  assert.deepEqual(
    data.lending.map((e) => [e.kind, e.currencyCode, e.amountMinor]),
    [
      ['LEND', 'BDT', 60],
      ['WRITE_OFF_LENT', 'BDT', 10],
    ],
  );
  const one = await netWorthData(1, today);
  assert.deepEqual(one.lending, []);
  assert.equal(one.mainCurrency, 'BDT');
});

test('netWorthData adds the received amount of a Transfer between Currencies', async () => {
  try {
    sqlite.exec(`INSERT INTO transactions (id, type, amountMinor, receivedAmountMinor, date, accountId, transferAccountId)
      VALUES (50, 'TRANSFER', 12000, 100, ${day(2026, 8, 1)}, 1, 2)`);
    const { changes } = await netWorthData(null, today);
    const august = 2026 * 12 + 7;
    assert.deepEqual(
      changes
        .filter((c) => c.month === august)
        .map((c) => [c.accountId, c.changeMinor])
        .sort((a, b) => a[0] - b[0]),
      [
        [1, -12000],
        [2, 100],
      ],
    );
  } finally {
    sqlite.exec('DELETE FROM transactions WHERE id = 50');
  }
});

test('the report settings read the Home start day and the first month of the fiscal year', async () => {
  assert.deepEqual(await reportSettings(), { monthStart: 1, fiscalStart: 0 });
  sqlite.exec(
    `INSERT INTO app_settings (key, value) VALUES ('homePeriod', '{"range":"week","monthStart":25}')`,
  );
  await saveFiscalStart(6);
  assert.deepEqual(await reportSettings(), { monthStart: 25, fiscalStart: 6 });
  await assert.rejects(saveFiscalStart(12), /Invalid month/);
});
