import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE transactions (id INTEGER PRIMARY KEY, type TEXT, amountMinor INTEGER CHECK(amountMinor > 0), date INTEGER, accountId INTEGER, categoryId INTEGER, note TEXT);
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE transaction_tags (transactionId INTEGER REFERENCES transactions(id), tagId INTEGER REFERENCES tags(id), PRIMARY KEY(transactionId, tagId));
INSERT INTO tags (name) VALUES ('Food');`);
let failLink = false;
const tx = {
  runAsync: async (sql, params) => {
    if (failLink && sql.startsWith('INSERT INTO transaction_tags')) throw new Error('link failed');
    const result = sqlite.prepare(sql).run(...params);
    return { lastInsertRowId: Number(result.lastInsertRowid) };
  },
  getFirstAsync: async (sql, params) => sqlite.prepare(sql).get(...params) ?? null,
};
globalThis.__quickAddTagsDb = {
  withExclusiveTransactionAsync: async (callback) => {
    sqlite.exec('BEGIN');
    try { await callback(tx); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return { url: 'test:database', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:database') return { format: 'module', source: 'export const database = async () => globalThis.__quickAddTagsDb; export const epochDay = () => 20000;', shortCircuit: true };
    if (url.endsWith('.ts')) {
      const loaded = next(url, { ...context, format: 'module' });
      return { ...loaded, format: 'module', source: stripTypeScriptTypes(loaded.source.toString()) };
    }
    return next(url, context);
  },
});
const { addQuickTransaction, parseQuickAddTags, MAX_QUICK_ADD_TAGS } = await import('./quick-add-tags.ts');
const input = { type: 'EXPENSE', amountMinor: 1234, accountId: 1, categoryId: 1, note: null };

test('normalizes input and limits unique tags', () => {
  assert.deepEqual(parseQuickAddTags(' Food, food , Travel '), ['Food', 'Travel']);
  assert.throws(() => parseQuickAddTags('a, ,b'), /empty tags/);
  assert.throws(() => parseQuickAddTags('a,'), /empty tags/);
  assert.throws(() => parseQuickAddTags(Array.from({ length: MAX_QUICK_ADD_TAGS + 1 }, (_, i) => `tag${i}`).join(',')), /at most/);
});

test('saves transaction and reuses existing tags regardless of case', async () => {
  await addQuickTransaction(input, ' food, FOOD , New ');
  assert.deepEqual(sqlite.prepare('SELECT name FROM tags ORDER BY id').all().map((row) => row.name), ['Food', 'New']);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM transaction_tags').get().n, 2);
  assert.equal(sqlite.prepare('SELECT amountMinor, date FROM transactions').get().date, 20000);
  await addQuickTransaction({ ...input, type: 'INCOME' }, '  ');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM transactions').get().n, 2);
});

test('invalid input or a tag write failure leaves no orphan transaction or tag', async () => {
  await assert.rejects(() => addQuickTransaction({ ...input, amountMinor: 0 }, 'ok'), /positive amount/);
  await assert.rejects(() => addQuickTransaction(input, 'bad,'), /empty tags/);
  failLink = true;
  await assert.rejects(() => addQuickTransaction(input, 'Brand New'), /link failed/);
  failLink = false;
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM transactions').get().n, 2);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM tags WHERE name = 'Brand New'").get().n, 0);
});
