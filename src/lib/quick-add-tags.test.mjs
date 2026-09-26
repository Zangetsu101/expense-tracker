import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const sqlite = new DatabaseSync(':memory:');
let failLink = false;
const adapter = {
  async execAsync(sql) { sqlite.exec(sql); },
  async runAsync(sql, params = []) {
    if (failLink && sql.startsWith('INSERT INTO transaction_tags')) throw new Error('link failed');
    const result = sqlite.prepare(sql).run(...params);
    return { lastInsertRowId: Number(result.lastInsertRowid) };
  },
  async getFirstAsync(sql, params = []) { return sqlite.prepare(sql).get(...params) ?? null; },
  async withExclusiveTransactionAsync(callback) {
    sqlite.exec('SAVEPOINT quick_add');
    try { const result = await callback(adapter); sqlite.exec('RELEASE quick_add'); return result; }
    catch (error) { sqlite.exec('ROLLBACK TO quick_add; RELEASE quick_add'); throw error; }
  },
};
globalThis.__quickAddDb = adapter;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'expo-sqlite') return { url: 'test:sqlite', shortCircuit: true };
    if (specifier.startsWith('./') && context.parentURL?.endsWith('.ts')) {
      const path = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
      return next(pathToFileURL(path.endsWith('.ts') ? path : `${path}.ts`).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:sqlite') return { format: 'module', source: 'export const openDatabaseAsync = async () => globalThis.__quickAddDb;', shortCircuit: true };
    if (url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
    return next(url, context);
  },
});
const { database } = await import('./database.ts');
const { addQuickTransaction, parseQuickAddTags, MAX_QUICK_ADD_TAGS } = await import('./quick-add-tags.ts');
await database();
sqlite.exec("INSERT INTO tags (name) VALUES ('Food')");
const input = { type: 'EXPENSE', amountMinor: 1234, accountId: 1, categoryId: 1, note: null };

test('normalizes input and limits unique tags', () => {
  assert.deepEqual(parseQuickAddTags(' Food, food , Travel '), ['Food', 'Travel']);
  assert.throws(() => parseQuickAddTags('a, ,b'), /empty tags/);
  assert.throws(() => parseQuickAddTags('a,'), /empty tags/);
  assert.throws(() => parseQuickAddTags(Array.from({ length: MAX_QUICK_ADD_TAGS + 1 }, (_, i) => `tag${i}`).join(',')), /at most/);
});

test('saves Transaction and reuses existing tags regardless of case', async () => {
  await addQuickTransaction(input, ' food, FOOD , New ');
  assert.deepEqual(sqlite.prepare('SELECT name FROM tags ORDER BY id').all().map((row) => row.name), ['Food', 'New']);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM transaction_tags').get().n, 2);
  assert.ok(Number.isSafeInteger(sqlite.prepare('SELECT date FROM transactions').get().date));
  await addQuickTransaction({ ...input, type: 'INCOME' }, '  ');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM transactions').get().n, 2);
});

test('invalid input or a tag write failure leaves no orphan Transaction or tag', async () => {
  await assert.rejects(() => addQuickTransaction({ ...input, amountMinor: 0 }, 'ok'), /positive amount/);
  await assert.rejects(() => addQuickTransaction(input, 'bad,'), /empty tags/);
  failLink = true;
  await assert.rejects(() => addQuickTransaction(input, 'Brand New'), /link failed/);
  failLink = false;
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM transactions').get().n, 2);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM tags WHERE name = 'Brand New'").get().n, 0);
});
