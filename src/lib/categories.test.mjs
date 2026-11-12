import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const db = new DatabaseSync(':memory:');
db.exec(
  'CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, parentId INTEGER REFERENCES categories(id), iconKey TEXT, needsReview INTEGER NOT NULL DEFAULT 0)',
);
const adapter = {
  runAsync: async (sql, params) => db.prepare(sql).run(...params),
  getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
  getFirstAsync: async (sql, params) => db.prepare(sql).get(...params) ?? null,
  async withExclusiveTransactionAsync(callback) {
    db.exec('SAVEPOINT create_category');
    try {
      const result = await callback(adapter);
      db.exec('RELEASE create_category');
      return result;
    } catch (error) {
      db.exec('ROLLBACK TO create_category; RELEASE create_category');
      throw error;
    }
  },
};
globalThis.__categoriesTestDb = adapter;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return { url: 'test:database', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:database')
      return {
        format: 'module',
        source: 'export const database = async () => globalThis.__categoriesTestDb;',
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
const {
  createCategory,
  updateCategory,
  listManagedCategories,
  listCategoriesByRecentUse,
  markCategoryReviewed,
} = await import('./categories.ts');

test('creates typed categories with same-type parents and rejects duplicate names per type', async () => {
  await createCategory({ name: " O'Brien ", type: 'EXPENSE' });
  await createCategory({ name: 'Food', type: 'EXPENSE', parentId: 1 });
  await createCategory({ name: "o'brien", type: 'INCOME' });
  assert.deepEqual(
    (await listManagedCategories()).map(({ name, type, parentName }) => [name, type, parentName]),
    [
      ['Food', 'EXPENSE', "O'Brien"],
      ["O'Brien", 'EXPENSE', null],
      ["o'brien", 'INCOME', null],
    ],
  );
  for (const input of [
    { name: ' food ', type: 'EXPENSE' },
    { name: 'Invalid', type: 'INCOME', parentId: 1 },
    { name: 'Invalid', type: 'EXPENSE', parentId: 999 },
    { name: 'Invalid', type: 'EXPENSE', parentId: -1 },
    { name: ' ', type: 'EXPENSE' },
    { name: 'Invalid', type: 'TRANSFER' },
  ])
    await assert.rejects(createCategory(input));
  assert.equal((await listManagedCategories()).length, 3);
});

test('creates descendants at any depth and validates failed writes without altering persistence', async () => {
  await createCategory({ name: 'Weekly groceries', type: 'EXPENSE', parentId: 2 });
  const child = (await listManagedCategories()).find(
    (category) => category.name === 'Weekly groceries',
  );
  await createCategory({ name: 'Vegetables', type: 'EXPENSE', parentId: child.id });
  const before = await listManagedCategories();
  assert.equal(before.find((category) => category.name === 'Vegetables').parentId, child.id);
  assert.equal(child.parentName, 'Food');
  for (const input of [
    { name: 'FOOD', type: 'EXPENSE', parentId: child.id },
    { name: 'x'.repeat(101), type: 'EXPENSE' },
    { name: 'Wrong type child', type: 'INCOME', parentId: child.id },
  ])
    await assert.rejects(createCategory(input));
  assert.deepEqual(await listManagedCategories(), before);
});

test('update changes only the name and preserves descendants, type, and review status', async () => {
  const before = await listManagedCategories();
  const category = before.find((category) => category.name === 'Food');
  db.prepare('UPDATE categories SET needsReview = 1 WHERE id = ?').run(category.id);
  await updateCategory(category.id, ' Dining ');
  const renamed = (await listManagedCategories()).find((item) => item.id === category.id);
  assert.deepEqual({ ...renamed }, { ...category, name: 'Dining', needsReview: 1 });
  const child = (await listManagedCategories()).find((item) => item.name === 'Weekly groceries');
  assert.equal(child.parentId, category.id);
  assert.equal(child.parentName, 'Dining');
  await updateCategory(category.id, 'DINING');
  assert.equal(
    (await listManagedCategories()).find((item) => item.id === category.id).name,
    'DINING',
  );
  await updateCategory(category.id, 'Food');
  db.prepare('UPDATE categories SET needsReview = 0 WHERE id = ?').run(category.id);
});

test('update validates names and IDs and rejects same-type duplicates without changing data', async () => {
  const before = await listManagedCategories();
  for (const [id, name] of [
    [2, ' '],
    [2, 'x'.repeat(101)],
    [2, " O'BRIEN "],
    [999, 'Missing'],
    [-1, 'Bad ID'],
    [1.5, 'Bad ID'],
    [NaN, 'Bad ID'],
  ])
    await assert.rejects(updateCategory(id, name));
  assert.deepEqual(await listManagedCategories(), before);
  await updateCategory(3, 'Food');
  assert.equal((await listManagedCategories()).find((item) => item.id === 3).type, 'INCOME');
  await updateCategory(3, "o'brien");
  await updateCategory(2, 'x'.repeat(100));
  assert.equal((await listManagedCategories()).find((item) => item.id === 2).name.length, 100);
  await updateCategory(2, 'Food');
});

test('a Category keeps an emoji that create and update set, and an empty emoji is none', async () => {
  await createCategory({ name: 'Coffee', type: 'EXPENSE', emoji: ' ☕ ' });
  const coffee = (await listManagedCategories()).find((item) => item.name === 'Coffee');
  assert.equal(coffee.emoji, '☕');
  await updateCategory(coffee.id, 'Cafes');
  assert.equal(
    (await listManagedCategories()).find((item) => item.id === coffee.id).emoji,
    '☕',
    'an update without an emoji keeps the emoji',
  );
  await updateCategory(coffee.id, 'Cafes', '👨‍👩‍👧‍👦');
  assert.equal((await listManagedCategories()).find((item) => item.id === coffee.id).emoji, '👨‍👩‍👧‍👦');
  await updateCategory(coffee.id, 'Cafes', '  ');
  assert.equal((await listManagedCategories()).find((item) => item.id === coffee.id).emoji, null);
  await assert.rejects(
    updateCategory(coffee.id, 'Cafes', 'x'.repeat(17)),
    /characters or fewer for the emoji/,
  );
  await assert.rejects(createCategory({ name: 'Tea', type: 'EXPENSE', emoji: 'x'.repeat(17) }));
  db.prepare('DELETE FROM categories WHERE id = ?').run(coffee.id);
});

test('review clears only the selected pending category', async () => {
  db.prepare('UPDATE categories SET needsReview = 1 WHERE id IN (1, 3)').run();
  await assert.rejects(markCategoryReviewed(1, 'INCOME'));
  await markCategoryReviewed(1, 'EXPENSE');
  assert.deepEqual(
    (await listManagedCategories()).filter(({ needsReview }) => needsReview).map(({ id }) => id),
    [3],
  );
  await assert.rejects(markCategoryReviewed(1, 'EXPENSE'));
  await assert.rejects(markCategoryReviewed(999, 'EXPENSE'));
});

test('typed managed Categories retain metadata in recent-first order', async () => {
  db.exec(`CREATE TABLE transactions(id INTEGER PRIMARY KEY, categoryId INTEGER, type TEXT, date INTEGER);
    INSERT INTO transactions VALUES(100, 1, 'EXPENSE', 1), (2, 2, 'EXPENSE', 2);`);
  const rows = await listCategoriesByRecentUse('EXPENSE');
  assert.deepEqual(
    rows.slice(0, 2).map((row) => row.id),
    [2, 1],
  );
  assert.ok(rows.every((row) => row.type === 'EXPENSE'));
  assert.equal(rows.find((row) => row.id === 2).parentId, 1);
  assert.equal(rows.find((row) => row.id === 2).parentName, rows.find((row) => row.id === 1).name);
});
