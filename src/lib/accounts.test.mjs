import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, currencyCode TEXT NOT NULL, openingBalanceMinor INTEGER NOT NULL DEFAULT 0, isFavorite INTEGER NOT NULL DEFAULT 0)');
const adapter = {
  runAsync: async (sql, params) => db.prepare(sql).run(...params),
  getAllAsync: async (sql) => db.prepare(sql).all(),
  getFirstAsync: async (sql, params) => db.prepare(sql).get(...params) ?? null,
  async withExclusiveTransactionAsync(callback) {
    db.exec('SAVEPOINT create_account');
    try {
      const result = await callback(adapter);
      db.exec('RELEASE create_account');
      return result;
    } catch (error) {
      db.exec('ROLLBACK TO create_account; RELEASE create_account');
      throw error;
    }
  },
};
globalThis.__accountsTestDb = adapter;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return { url: 'test:database', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:database') return { format: 'module', source: 'export const database = async () => globalThis.__accountsTestDb; export async function setFavoriteAccount(id) { const row = globalThis.__accountsTestDb; const accounts = await row.getAllAsync("SELECT id FROM accounts"); if (!accounts.some(a => a.id === id)) throw Error("Account not found."); await row.runAsync("UPDATE accounts SET isFavorite = CASE WHEN id = ? THEN 1 ELSE 0 END", [id]); }', shortCircuit: true };
    if (url.endsWith('.ts')) {
      const loaded = next(url, { ...context, format: 'module' });
      return { ...loaded, format: 'module', source: stripTypeScriptTypes(loaded.source.toString()) };
    }
    return next(url, context);
  },
});
const { createAccount, listManagedAccounts, parseOpeningBalance, setFavoriteAccount } = await import('./accounts.ts');

test('opening balance parses exact minor units, including negative and zero', () => {
  assert.equal(parseOpeningBalance('-12.34'), -1234);
  assert.equal(parseOpeningBalance('0'), 0);
  assert.equal(parseOpeningBalance('+2.5'), 250);
  for (const value of ['', '1.234', '1e3', 'NaN', '90071992547410', '1,000']) assert.throws(() => parseOpeningBalance(value));
});

test('creation validates before writing, parameterizes names and stores currency and opening balance', async () => {
  for (const input of [
    { name: ' ', currencyCode: 'USD', openingBalance: '0' },
    { name: 'Cash', currencyCode: 'US$ ', openingBalance: '0' },
    { name: 'Cash', currencyCode: 'USD', openingBalance: '1.234' },
  ]) await assert.rejects(createAccount(input));
  assert.equal((await listManagedAccounts()).length, 0);
  await createAccount({ name: "  O'Brien; DROP TABLE accounts; -- ", currencyCode: ' bdt ', openingBalance: '-10.01' });
  await createAccount({ name: 'Savings', currencyCode: 'USD', openingBalance: '25' });
  await assert.rejects(createAccount({ name: ' savings ', currencyCode: 'EUR', openingBalance: '0' }), /already exists/);
  const rows = await listManagedAccounts();
  assert.equal(rows[0].name, "O'Brien; DROP TABLE accounts; --");
  assert.equal(rows[0].currencyCode, 'BDT');
  assert.equal(rows[0].openingBalanceMinor, -1001);
  assert.equal(rows[1].openingBalanceMinor, 2500);
  await setFavoriteAccount(rows[1].id);
  assert.equal((await listManagedAccounts())[0].name, 'Savings');
});
