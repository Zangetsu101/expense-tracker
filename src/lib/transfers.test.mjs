import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE accounts (id INTEGER PRIMARY KEY, currencyCode TEXT NOT NULL);
CREATE TABLE transactions (id INTEGER PRIMARY KEY, type TEXT NOT NULL, amountMinor INTEGER NOT NULL CHECK(amountMinor > 0), date INTEGER NOT NULL, accountId INTEGER NOT NULL REFERENCES accounts(id), transferAccountId INTEGER REFERENCES accounts(id), categoryId INTEGER, note TEXT);
INSERT INTO accounts VALUES (1, 'BDT'), (2, 'BDT'), (3, 'USD');`);
const tx = {
  getAllAsync: async (sql, params) => sqlite.prepare(sql).all(...params),
  runAsync: async (sql, params) => sqlite.prepare(sql).run(...params),
};
globalThis.__transferTestDb = {
  withExclusiveTransactionAsync: async (callback) => {
    sqlite.exec('BEGIN');
    try { const result = await callback(tx); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return { url: 'test:database', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:database') return { format: 'module', source: 'export const database = async () => globalThis.__transferTestDb; export const epochDay = (date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);', shortCircuit: true };
    if (url.endsWith('.ts')) {
      const loaded = next(url, { ...context, format: 'module' });
      return { ...loaded, format: 'module', source: stripTypeScriptTypes(loaded.source.toString()) };
    }
    return next(url, context);
  },
});
const { addTransfer, transferAmountMinor } = await import('./transfers.ts');

test('amount parser accepts cents without rounding or unsafe integers', () => {
  assert.equal(transferAmountMinor(' 12.34 '), 1234);
  assert.equal(transferAmountMinor('0.01'), 1);
  for (const value of ['', '0', '-1', '1.234', '1e2', 'NaN', '90071992547410']) {
    assert.throws(() => transferAmountMinor(value), /positive amount/);
  }
});

test('saves one same-currency transfer with a local date and no category', async () => {
  await addTransfer({ amountMinor: 1234, fromAccountId: 1, toAccountId: 2, note: '  rent  ' });
  const rows = sqlite.prepare('SELECT type, amountMinor, date, accountId, transferAccountId, categoryId, note FROM transactions').all();
  const today = new Date();
  assert.deepEqual(rows.map((row) => ({ ...row })), [{ type: 'TRANSFER', amountMinor: 1234, date: Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000), accountId: 1, transferAccountId: 2, categoryId: null, note: 'rent' }]);
});

test('invalid accounts, currency and amount leave the database unchanged', async () => {
  const count = () => sqlite.prepare('SELECT COUNT(*) AS total FROM transactions').get().total;
  const before = count();
  for (const input of [
    { amountMinor: 0, fromAccountId: 1, toAccountId: 2 },
    { amountMinor: 1.5, fromAccountId: 1, toAccountId: 2 },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1, fromAccountId: 1, toAccountId: 2 },
    { amountMinor: 1, fromAccountId: 1, toAccountId: 1 },
    { amountMinor: 1, fromAccountId: 1, toAccountId: 3 },
    { amountMinor: 1, fromAccountId: 1, toAccountId: 999 },
  ]) {
    await assert.rejects(() => addTransfer({ ...input, note: null }));
    assert.equal(count(), before);
  }
});
