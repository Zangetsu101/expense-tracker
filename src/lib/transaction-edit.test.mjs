import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, currencyCode TEXT);
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE transactions (id INTEGER PRIMARY KEY, type TEXT, amountMinor INTEGER, date INTEGER, accountId INTEGER, categoryId INTEGER, note TEXT, excludeFromReport INTEGER);
INSERT INTO accounts VALUES (1, 'Cash', 'BDT');
INSERT INTO categories VALUES (1, 'Food');
INSERT INTO transactions VALUES (1, 'EXPENSE', 1234, 20000, 1, 1, 'old', 0), (2, 'TRANSFER', 500, 20001, 1, NULL, 'move', 0);`);
const connection = {
  getFirstAsync: async (sql, params) => sqlite.prepare(sql).get(...params) ?? null,
  runAsync: async (sql, params) => ({ changes: sqlite.prepare(sql).run(...params).changes }),
};
globalThis.__transactionEditTestDb = connection;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return { url: 'test:database', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:database') return { format: 'module', source: 'export const database = async () => globalThis.__transactionEditTestDb;', shortCircuit: true };
    if (url.endsWith('.ts')) {
      const loaded = next(url, { ...context, format: 'module' });
      return { ...loaded, format: 'module', source: stripTypeScriptTypes(loaded.source.toString()) };
    }
    return next(url, context);
  },
});
const { loadEditableTransaction, saveTransactionEdit } = await import('./transaction-edit.ts');

test('updates only note and report exclusion, preserving financial fields', async () => {
  const original = await loadEditableTransaction(1);
  assert.equal(original.note, 'old');
  await saveTransactionEdit(original, '  lunch  ', true);
  assert.deepEqual({ ...sqlite.prepare('SELECT type, amountMinor, date, accountId, categoryId, note, excludeFromReport FROM transactions WHERE id = 1').get() },
    { type: 'EXPENSE', amountMinor: 1234, date: 20000, accountId: 1, categoryId: 1, note: 'lunch', excludeFromReport: 1 });
  await saveTransactionEdit(await loadEditableTransaction(1), '', false);
  assert.equal((await loadEditableTransaction(1)).note, null);
  assert.equal((await loadEditableTransaction(1)).excludeFromReport, 0);
});

test('rejects missing and transfer transactions, and stale edits', async () => {
  assert.equal(await loadEditableTransaction(2), null);
  assert.equal(await loadEditableTransaction(999), null);
  assert.rejects(() => loadEditableTransaction(-1), /Invalid transaction ID/);
  const original = await loadEditableTransaction(1);
  sqlite.prepare('UPDATE transactions SET note = ? WHERE id = 1').run('another edit');
  await assert.rejects(() => saveTransactionEdit(original, 'overwrite', true), /changed or removed/);
  assert.equal(sqlite.prepare('SELECT note FROM transactions WHERE id = 1').get().note, 'another edit');
  await assert.rejects(() => saveTransactionEdit({ ...original, id: 2, type: 'TRANSFER' }, 'x', true), /Transfers/);
  const beforeAmountChange = await loadEditableTransaction(1);
  sqlite.prepare('UPDATE transactions SET amountMinor = ? WHERE id = 1').run(999);
  await assert.rejects(() => saveTransactionEdit(beforeAmountChange, 'overwrite', true), /changed or removed/);
  const beforeCategoryChange = await loadEditableTransaction(1);
  sqlite.prepare('UPDATE transactions SET categoryId = NULL WHERE id = 1').run();
  await assert.rejects(() => saveTransactionEdit(beforeCategoryChange, 'overwrite', true), /changed or removed/);
});
