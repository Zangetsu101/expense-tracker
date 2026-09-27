import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sqlite = new DatabaseSync(':memory:');
const adapter = {
  execAsync: async (sql) => sqlite.exec(sql),
  runAsync: async (sql, params = []) => sqlite.prepare(sql).run(...params),
  getAllAsync: async (sql, params = []) => sqlite.prepare(sql).all(...params).map((row) => ({ ...row })),
  getFirstAsync: async (sql, params = []) => sqlite.prepare(sql).get(...params) ?? null,
};
globalThis.__homeSqliteAdapter = adapter;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/database') return { url: new URL('./database.ts', import.meta.url).href, shortCircuit: true };
    if (specifier === 'expo-sqlite') return { url: 'test:sqlite', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:sqlite') return { format: 'module', source: 'export const openDatabaseAsync = async () => globalThis.__homeSqliteAdapter;', shortCircuit: true };
    if (url.endsWith('.ts')) {
      const loaded = next(url, { ...context, format: 'module' });
      return { ...loaded, format: 'module', source: stripTypeScriptTypes(loaded.source.toString()) };
    }
    return next(url, context);
  },
});
const { database, epochDay } = await import('./database.ts');
const { homeData } = await import('./home-data.ts');
await database();
sqlite.exec(`DELETE FROM transactions; DELETE FROM categories; DELETE FROM accounts;
  INSERT INTO accounts (id, name, currencyCode) VALUES (1, 'Cash', 'BDT'), (2, 'Bank', 'USD');
  INSERT INTO categories (id, name, type) VALUES (1, 'Food', 'EXPENSE');`);
const day = (year, month, date) => epochDay(new Date(year, month - 1, date));
const add = (id, type, amount, date, account, excluded = 0, destination = null) =>
  sqlite.prepare(`INSERT INTO transactions (id, type, amountMinor, date, accountId, categoryId, excludeFromReport, transferAccountId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, type, amount, date, account, type === 'EXPENSE' ? 1 : null, excluded, destination);

 test('Home reads recent activity and keeps reportable monthly totals separate by Currency', async () => {
  add(1, 'EXPENSE', 12000, day(2025, 1, 3), 1);
  add(2, 'INCOME', 500, day(2025, 1, 4), 2);
  add(3, 'TRANSFER', 100, day(2025, 1, 5), 1, 0, 1);
  add(4, 'EXPENSE', 200, day(2025, 1, 6), 2, 1);
  add(5, 'EXPENSE', 900, day(2024, 12, 31), 2);
  const result = await homeData(new Date(2025, 0, 20));
  assert.deepEqual(result.summaries, [
    { currencyCode: 'BDT', incomeMinor: 0, expenseMinor: 12000 },
    { currencyCode: 'USD', incomeMinor: 500, expenseMinor: 0 },
  ]);
  assert.deepEqual(result.rows.map(({ id, currencyCode, transferAccountName }) => ({ id, currencyCode, transferAccountName })), [
    { id: 4, currencyCode: 'USD', transferAccountName: null },
    { id: 3, currencyCode: 'BDT', transferAccountName: 'Cash' },
    { id: 2, currencyCode: 'USD', transferAccountName: null },
    { id: 1, currencyCode: 'BDT', transferAccountName: null },
    { id: 5, currencyCode: 'USD', transferAccountName: null },
  ]);
});
