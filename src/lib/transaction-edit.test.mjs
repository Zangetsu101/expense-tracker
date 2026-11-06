import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, currencyCode TEXT);
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE transactions (id INTEGER PRIMARY KEY, type TEXT, amountMinor INTEGER, date INTEGER, accountId INTEGER, categoryId INTEGER, note TEXT, excludeFromReport INTEGER);
CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE lending_entries (id INTEGER PRIMARY KEY, transactionId INTEGER UNIQUE, personId INTEGER, kind TEXT);
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
CREATE TABLE line_items (id INTEGER PRIMARY KEY, transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, name TEXT NOT NULL, amountMinor INTEGER NOT NULL, quantity REAL);
CREATE TABLE transaction_tags (transactionId INTEGER REFERENCES transactions(id), tagId INTEGER REFERENCES tags(id), PRIMARY KEY(transactionId, tagId));
INSERT INTO accounts VALUES (1, 'Cash', 'BDT');
INSERT INTO categories VALUES (1, 'Food');
INSERT INTO transactions VALUES (1, 'EXPENSE', 1234, 20000, 1, 1, 'old', 0), (2, 'TRANSFER', 500, 20001, 1, NULL, 'move', 0);
INSERT INTO tags VALUES (1, 'Food'), (2, 'Shared');
INSERT INTO transaction_tags VALUES (1, 1), (2, 2);
INSERT INTO line_items VALUES (1, 1, 'Coffee', 100, 2);
ALTER TABLE transactions ADD COLUMN source TEXT DEFAULT 'MANUAL';`);
let failLink = false;
let failItem = false;
const tx = {
  getFirstAsync: async (sql, params) => sqlite.prepare(sql).get(...params) ?? null,
  getAllAsync: async (sql, params) => sqlite.prepare(sql).all(...params),
  runAsync: async (sql, params) => {
    if (failLink && sql.startsWith('INSERT INTO transaction_tags')) throw new Error('link failed');
    if (failItem && sql.startsWith('INSERT INTO line_items')) throw new Error('item failed');
    const result = sqlite.prepare(sql).run(...params);
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  },
};
globalThis.__transactionEditTestDb = {
  ...tx,
  withExclusiveTransactionAsync: async (callback) => {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = await callback(tx);
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return { url: 'test:database', shortCircuit: true };
    if (specifier === './quick-add-tags' || specifier === './tag-store')
      return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:database')
      return {
        format: 'module',
        source:
          'export const database = async () => globalThis.__transactionEditTestDb; export const epochDay = () => 0;',
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
const { loadEditableTransaction, saveTransactionEdit } = await import('./transaction-edit.ts');
const { transactionTitle } = await import('./transaction-format.ts');

test('receipt data includes linked lending kind and person even for categorized history', async () => {
  sqlite.exec(
    "INSERT INTO people VALUES (1, 'Sam'); INSERT INTO lending_entries VALUES (10, 1, 1, 'LEND')",
  );
  try {
    assert.equal(transactionTitle(await loadEditableTransaction(1)), 'Lent to Sam');
    assert.equal(await loadEditableTransaction(2), null);
  } finally {
    sqlite.exec('DELETE FROM lending_entries; DELETE FROM people');
  }
});

test('edits tags, note and exclusion without changing financial fields or shared tags', async () => {
  const original = await loadEditableTransaction(1);
  assert.equal(original.reportExclusionLocked, 0);
  assert.deepEqual(
    original.tags.map(({ id, name }) => ({ id, name })),
    [{ id: 1, name: 'Food' }],
  );
  await saveTransactionEdit(original, '  lunch  ', true, ' food, Shared, shared, New ');
  assert.deepEqual(
    {
      ...sqlite
        .prepare(
          'SELECT type, amountMinor, date, accountId, categoryId, note, excludeFromReport FROM transactions WHERE id = 1',
        )
        .get(),
    },
    {
      type: 'EXPENSE',
      amountMinor: 1234,
      date: 20000,
      accountId: 1,
      categoryId: 1,
      note: 'lunch',
      excludeFromReport: 1,
    },
  );
  assert.deepEqual(
    (await loadEditableTransaction(1)).tags.map((tag) => tag.name),
    ['Food', 'Shared', 'New'],
  );
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM tags').get().n, 3);
  await saveTransactionEdit(await loadEditableTransaction(1), '', false, '');
  assert.equal((await loadEditableTransaction(1)).note, null);
  assert.equal((await loadEditableTransaction(1)).excludeFromReport, 0);
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM transaction_tags WHERE transactionId = 1').get().n,
    0,
  );
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM transaction_tags WHERE transactionId = 2').get().n,
    1,
  );
});

test('editing a linked principal cannot include it in reports', async () => {
  sqlite.exec('INSERT INTO lending_entries (id, transactionId) VALUES (1, 1)');
  try {
    assert.equal((await loadEditableTransaction(1)).reportExclusionLocked, 1);
    await saveTransactionEdit(await loadEditableTransaction(1), 'principal note', false, '');
    assert.equal((await loadEditableTransaction(1)).excludeFromReport, 1);
    assert.equal((await loadEditableTransaction(1)).note, 'principal note');
  } finally {
    sqlite.exec('DELETE FROM lending_entries');
  }
});

test('rejects invalid input, missing and transfer transactions, and stale edits', async () => {
  assert.equal(await loadEditableTransaction(2), null);
  assert.equal(await loadEditableTransaction(999), null);
  await assert.rejects(() => loadEditableTransaction(-1), /Invalid transaction ID/);
  const original = await loadEditableTransaction(1);
  await assert.rejects(() => saveTransactionEdit(original, 'x', true, 'a,'), /empty tags/);
  await assert.rejects(
    () => saveTransactionEdit({ ...original, id: 2, type: 'TRANSFER' }, 'x', true, ''),
    /Transfers/,
  );
  sqlite.prepare('UPDATE transactions SET note = ? WHERE id = 1').run('another edit');
  await assert.rejects(
    () => saveTransactionEdit(original, 'overwrite', true, 'Unwanted'),
    /changed or removed/,
  );
  assert.equal(
    sqlite.prepare('SELECT count(*) AS n FROM tags WHERE name = ?').get('Unwanted').n,
    0,
  );
  const beforeAmountChange = await loadEditableTransaction(1);
  sqlite.prepare('UPDATE transactions SET amountMinor = ? WHERE id = 1').run(999);
  await assert.rejects(
    () => saveTransactionEdit(beforeAmountChange, 'overwrite', true, ''),
    /changed or removed/,
  );
  const beforeCategoryChange = await loadEditableTransaction(1);
  sqlite.prepare('UPDATE transactions SET categoryId = NULL WHERE id = 1').run();
  await assert.rejects(
    () => saveTransactionEdit(beforeCategoryChange, 'overwrite', true, ''),
    /changed or removed/,
  );
  const beforeTagChange = await loadEditableTransaction(1);
  sqlite.prepare('INSERT INTO transaction_tags VALUES (1, 2)').run();
  await assert.rejects(
    () => saveTransactionEdit(beforeTagChange, 'overwrite', true, ''),
    /changed or removed/,
  );
});

test('line items are optional, editable, and independent of transaction amount', async () => {
  const original = await loadEditableTransaction(1);
  assert.deepEqual(
    original.lineItems.map((item) => ({ ...item })),
    [{ id: 1, name: 'Coffee', amountMinor: 100, quantity: 2 }],
  );
  await saveTransactionEdit(original, '', false, '', [
    { name: 'Snack', amountMinor: 9000, quantity: 1.5 },
    { id: 1, name: 'Tea', amountMinor: 75, quantity: null },
  ]);
  assert.equal(
    sqlite.prepare('SELECT amountMinor FROM transactions WHERE id = 1').get().amountMinor,
    999,
  );
  assert.deepEqual(
    (await loadEditableTransaction(1)).lineItems.map(({ name, amountMinor }) => [
      name,
      amountMinor,
    ]),
    [
      ['Tea', 75],
      ['Snack', 9000],
    ],
  );
  const latest = await loadEditableTransaction(1);
  for (const item of [
    { name: '', amountMinor: 1, quantity: null },
    { name: 'x', amountMinor: NaN, quantity: null },
    { name: 'x', amountMinor: Number.MAX_SAFE_INTEGER + 1, quantity: null },
    { name: 'x', amountMinor: 1, quantity: Infinity },
  ]) {
    await assert.rejects(() => saveTransactionEdit(latest, 'bad', true, '', [item]), /Line item/);
  }
  sqlite.prepare('UPDATE line_items SET name = ? WHERE id = 1').run('External');
  await assert.rejects(
    () => saveTransactionEdit(latest, 'stale', true, '', []),
    /changed or removed/,
  );
  assert.notEqual((await loadEditableTransaction(1)).note, 'stale');
  const fresh = await loadEditableTransaction(1);
  const priorLinks = sqlite
    .prepare('SELECT * FROM transaction_tags WHERE transactionId = 1 ORDER BY tagId')
    .all();
  const priorTags = sqlite.prepare('SELECT * FROM tags ORDER BY id').all();
  failItem = true;
  try {
    await assert.rejects(
      () =>
        saveTransactionEdit(fresh, 'rollback item', true, 'NewTag', [
          { name: 'Failure', amountMinor: 1, quantity: null },
        ]),
      /item failed/,
    );
  } finally {
    failItem = false;
  }
  assert.deepEqual((await loadEditableTransaction(1)).lineItems, fresh.lineItems);
  assert.equal((await loadEditableTransaction(1)).note, fresh.note);
  assert.deepEqual(
    sqlite.prepare('SELECT * FROM transaction_tags WHERE transactionId = 1 ORDER BY tagId').all(),
    priorLinks,
  );
  assert.deepEqual(sqlite.prepare('SELECT * FROM tags ORDER BY id').all(), priorTags);
  await saveTransactionEdit(fresh, '', false, '', []);
  assert.deepEqual((await loadEditableTransaction(1)).lineItems, []);
});

test('note-only edits preserve restored zero and negative Line Item amounts', async () => {
  sqlite
    .prepare(
      "INSERT INTO line_items (transactionId, name, amountMinor) VALUES (1, 'Credit', -125), (1, 'Free', 0)",
    )
    .run();
  const original = await loadEditableTransaction(1);
  await saveTransactionEdit(original, 'updated', false, '', original.lineItems);
  assert.deepEqual(
    (await loadEditableTransaction(1)).lineItems.map((item) => item.amountMinor),
    [-125, 0],
  );
});

test('rolls back note, links and new tags on SQLite failure', async () => {
  const original = await loadEditableTransaction(1);
  const before = sqlite
    .prepare('SELECT * FROM transaction_tags WHERE transactionId = 1 ORDER BY tagId')
    .all();
  const count = sqlite.prepare('SELECT count(*) AS n FROM tags').get().n;
  failLink = true;
  try {
    await assert.rejects(
      () => saveTransactionEdit(original, 'rollback', true, 'Brand New'),
      /link failed/,
    );
  } finally {
    failLink = false;
  }
  assert.equal((await loadEditableTransaction(1)).note, original.note);
  assert.equal((await loadEditableTransaction(1)).excludeFromReport, original.excludeFromReport);
  assert.deepEqual(
    sqlite.prepare('SELECT * FROM transaction_tags WHERE transactionId = 1 ORDER BY tagId').all(),
    before,
  );
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM tags').get().n, count);
});
