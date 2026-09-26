import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, parentId INTEGER REFERENCES categories(id), needsReview INTEGER NOT NULL DEFAULT 0)');
const adapter = {
  runAsync: async (sql, params) => db.prepare(sql).run(...params),
  getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
  getFirstAsync: async (sql, params) => db.prepare(sql).get(...params) ?? null,
  async withExclusiveTransactionAsync(callback) {
    db.exec('SAVEPOINT create_category');
    try { const result = await callback(adapter); db.exec('RELEASE create_category'); return result; }
    catch (error) { db.exec('ROLLBACK TO create_category; RELEASE create_category'); throw error; }
  },
};
globalThis.__categoriesTestDb = adapter;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return { url: 'test:database', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:database') return { format: 'module', source: 'export const database = async () => globalThis.__categoriesTestDb;', shortCircuit: true };
    if (url.endsWith('.ts')) {
      const loaded = next(url, { ...context, format: 'module' });
      return { ...loaded, format: 'module', source: stripTypeScriptTypes(loaded.source.toString()) };
    }
    return next(url, context);
  },
});
const { createCategory, listManagedCategories, markCategoryReviewed } = await import('./categories.ts');

test('creates typed categories with same-type parents and rejects duplicate names per type', async () => {
  await createCategory({ name: " O'Brien ", type: 'EXPENSE' });
  await createCategory({ name: 'Food', type: 'EXPENSE', parentId: 1 });
  await createCategory({ name: "o'brien", type: 'INCOME' });
  assert.deepEqual((await listManagedCategories()).map(({ name, type, parentName }) => [name, type, parentName]), [
    ['Food', 'EXPENSE', "O'Brien"], ["O'Brien", 'EXPENSE', null], ["o'brien", 'INCOME', null],
  ]);
  for (const input of [
    { name: ' food ', type: 'EXPENSE' },
    { name: 'Invalid', type: 'INCOME', parentId: 1 },
    { name: 'Invalid', type: 'EXPENSE', parentId: 999 },
    { name: 'Invalid', type: 'EXPENSE', parentId: -1 },
    { name: ' ', type: 'EXPENSE' },
    { name: 'Invalid', type: 'TRANSFER' },
  ]) await assert.rejects(createCategory(input));
  assert.equal((await listManagedCategories()).length, 3);
});

test('review clears only the selected pending category', async () => {
  db.prepare('UPDATE categories SET needsReview = 1 WHERE id IN (1, 3)').run();
  await markCategoryReviewed(1);
  assert.deepEqual((await listManagedCategories()).map(({ needsReview }) => needsReview), [0, 0, 1]);
  await assert.rejects(markCategoryReviewed(1));
  await assert.rejects(markCategoryReviewed(999));
});
