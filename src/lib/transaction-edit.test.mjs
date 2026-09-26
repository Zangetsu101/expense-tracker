import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, currencyCode TEXT);
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE transactions (id INTEGER PRIMARY KEY, type TEXT, amountMinor INTEGER, date INTEGER, accountId INTEGER, categoryId INTEGER, note TEXT, excludeFromReport INTEGER);
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
CREATE TABLE transaction_tags (transactionId INTEGER REFERENCES transactions(id), tagId INTEGER REFERENCES tags(id), PRIMARY KEY(transactionId, tagId));
INSERT INTO accounts VALUES (1, 'Cash', 'BDT');
INSERT INTO categories VALUES (1, 'Food');
INSERT INTO transactions VALUES (1, 'EXPENSE', 1234, 20000, 1, 1, 'old', 0), (2, 'TRANSFER', 500, 20001, 1, NULL, 'move', 0);
INSERT INTO tags VALUES (1, 'Food'), (2, 'Shared');
INSERT INTO transaction_tags VALUES (1, 1), (2, 2);`);
let failLink = false;
const tx = {
  getFirstAsync: async (sql, params) => sqlite.prepare(sql).get(...params) ?? null,
  getAllAsync: async (sql, params) => sqlite.prepare(sql).all(...params),
  runAsync: async (sql, params) => {
    if (failLink && sql.startsWith('INSERT INTO transaction_tags')) throw new Error('link failed');
    const result = sqlite.prepare(sql).run(...params);
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  },
};
globalThis.__transactionEditTestDb = {
  ...tx,
  withExclusiveTransactionAsync: async (callback) => {
    sqlite.exec('BEGIN IMMEDIATE');
    try { const result = await callback(tx); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return { url: 'test:database', shortCircuit: true };
    if (specifier === './quick-add-tags') return next('./quick-add-tags.ts', context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:database') return { format: 'module', source: 'export const database = async () => globalThis.__transactionEditTestDb; export const epochDay = () => 0;', shortCircuit: true };
    if (url.endsWith('.ts')) {
      const loaded = next(url, { ...context, format: 'module' });
      return { ...loaded, format: 'module', source: stripTypeScriptTypes(loaded.source.toString()) };
    }
    return next(url, context);
  },
});
const { loadEditableTransaction, saveTransactionEdit } = await import('./transaction-edit.ts');

test('edits tags, note and exclusion without changing financial fields or shared tags', async () => {
  const original = await loadEditableTransaction(1);
  assert.deepEqual(original.tags.map(({ id, name }) => ({ id, name })), [{ id: 1, name: 'Food' }]);
  await saveTransactionEdit(original, '  lunch  ', true, ' food, Shared, shared, New ');
  assert.deepEqual({ ...sqlite.prepare('SELECT type, amountMinor, date, accountId, categoryId, note, excludeFromReport FROM transactions WHERE id = 1').get() },
    { type: 'EXPENSE', amountMinor: 1234, date: 20000, accountId: 1, categoryId: 1, note: 'lunch', excludeFromReport: 1 });
  assert.deepEqual((await loadEditableTransaction(1)).tags.map((tag) => tag.name), ['Food', 'Shared', 'New']);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM tags').get().n, 3);
  await saveTransactionEdit(await loadEditableTransaction(1), '', false, '');
  assert.equal((await loadEditableTransaction(1)).note, null);
  assert.equal((await loadEditableTransaction(1)).excludeFromReport, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM transaction_tags WHERE transactionId = 1').get().n, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM transaction_tags WHERE transactionId = 2').get().n, 1);
});

test('rejects invalid input, missing and transfer transactions, and stale edits', async () => {
  assert.equal(await loadEditableTransaction(2), null);
  assert.equal(await loadEditableTransaction(999), null);
  await assert.rejects(() => loadEditableTransaction(-1), /Invalid transaction ID/);
  const original = await loadEditableTransaction(1);
  await assert.rejects(() => saveTransactionEdit(original, 'x', true, 'a,'), /empty tags/);
  await assert.rejects(() => saveTransactionEdit({ ...original, id: 2, type: 'TRANSFER' }, 'x', true, ''), /Transfers/);
  sqlite.prepare('UPDATE transactions SET note = ? WHERE id = 1').run('another edit');
  await assert.rejects(() => saveTransactionEdit(original, 'overwrite', true, 'Unwanted'), /changed or removed/);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM tags WHERE name = ?').get('Unwanted').n, 0);
  const beforeAmountChange = await loadEditableTransaction(1);
  sqlite.prepare('UPDATE transactions SET amountMinor = ? WHERE id = 1').run(999);
  await assert.rejects(() => saveTransactionEdit(beforeAmountChange, 'overwrite', true, ''), /changed or removed/);
  const beforeCategoryChange = await loadEditableTransaction(1);
  sqlite.prepare('UPDATE transactions SET categoryId = NULL WHERE id = 1').run();
  await assert.rejects(() => saveTransactionEdit(beforeCategoryChange, 'overwrite', true, ''), /changed or removed/);
  const beforeTagChange = await loadEditableTransaction(1);
  sqlite.prepare('INSERT INTO transaction_tags VALUES (1, 2)').run();
  await assert.rejects(() => saveTransactionEdit(beforeTagChange, 'overwrite', true, ''), /changed or removed/);
});

test('rolls back note, links and new tags on SQLite failure', async () => {
  const original = await loadEditableTransaction(1);
  const before = sqlite.prepare('SELECT * FROM transaction_tags WHERE transactionId = 1 ORDER BY tagId').all();
  const count = sqlite.prepare('SELECT count(*) AS n FROM tags').get().n;
  failLink = true;
  try {
    await assert.rejects(() => saveTransactionEdit(original, 'rollback', true, 'Brand New'), /link failed/);
  } finally { failLink = false; }
  assert.equal((await loadEditableTransaction(1)).note, original.note);
  assert.equal((await loadEditableTransaction(1)).excludeFromReport, original.excludeFromReport);
  assert.deepEqual(sqlite.prepare('SELECT * FROM transaction_tags WHERE transactionId = 1 ORDER BY tagId').all(), before);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM tags').get().n, count);
});
