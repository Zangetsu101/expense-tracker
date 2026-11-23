import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { addTransaction } from '../test/ledger-rows.ts';
import { legsSchema } from './legs-schema.ts';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON');
sqlite.exec(legsSchema);
sqlite.exec(`INSERT INTO accounts (id, name, currencyCode) VALUES (1, 'Cash', 'BDT'), (2, 'Bank', 'BDT');
INSERT INTO categories (id, name, type) VALUES (1, 'Food', 'EXPENSE');`);
addTransaction(sqlite, {
  id: 1,
  type: 'EXPENSE',
  amountMinor: 1234,
  date: 20000,
  accountId: 1,
  categoryId: 1,
  note: 'old',
});
addTransaction(sqlite, {
  id: 2,
  type: 'TRANSFER',
  amountMinor: 500,
  date: 20001,
  accountId: 1,
  transferAccountId: 2,
  note: 'move',
});
sqlite.exec(`INSERT INTO tags VALUES (1, 'Food'), (2, 'Shared');
INSERT INTO transaction_tags VALUES (1, 1), (2, 2);
INSERT INTO line_items VALUES (1, 1, 'Coffee', 100, 2);`);
let failLink = false;
let failItem = false;
const tx = {
  getFirstAsync: async (sql, params) => sqlite.prepare(sql).get(...params) ?? null,
  getAllAsync: async (sql, params = []) => sqlite.prepare(sql).all(...params),
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

/** Adds a lending Transaction with the person Sam. */
function lend(id) {
  sqlite.exec("INSERT OR IGNORE INTO people VALUES (1, 'Sam')");
  addTransaction(sqlite, {
    id,
    type: 'EXPENSE',
    amountMinor: 300,
    date: 20000,
    accountId: 1,
    lending: { personId: 1, kind: 'LEND' },
  });
}

test('receipt data includes the lending kind and person', async () => {
  lend(10);
  try {
    const receipt = await loadEditableTransaction(10);
    assert.equal(transactionTitle(receipt), 'Lent to Sam');
    assert.equal(receipt.personId, 1);
    assert.equal(receipt.lendingKind, 'LEND');
    assert.equal(receipt.type, 'EXPENSE');
    assert.equal(await loadEditableTransaction(2), null);
  } finally {
    sqlite.exec('DELETE FROM transactions WHERE id = 10');
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
          'SELECT kind, amountMinor, date, accountId, categoryId, note, excludeFromReport FROM transactions t JOIN legs l ON l.transactionId = t.id WHERE t.id = 1',
        )
        .get(),
    },
    {
      kind: 'EXPENSE',
      amountMinor: -1234,
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
  lend(11);
  try {
    assert.equal((await loadEditableTransaction(11)).reportExclusionLocked, 1);
    await saveTransactionEdit(await loadEditableTransaction(11), 'principal note', false, '');
    assert.equal((await loadEditableTransaction(11)).excludeFromReport, 1);
    assert.equal((await loadEditableTransaction(11)).note, 'principal note');
    assert.equal(
      sqlite.prepare('SELECT excludeFromReport FROM transactions WHERE id = 11').get()
        .excludeFromReport,
      0,
      'lending stores no report exclusion',
    );
  } finally {
    sqlite.exec('DELETE FROM transactions WHERE id = 11');
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
  sqlite.prepare('UPDATE legs SET amountMinor = ? WHERE transactionId = 1').run(-999);
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
    sqlite.prepare('SELECT amountMinor FROM legs WHERE transactionId = 1').get().amountMinor,
    -999,
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

test('Receipt amount edits require confirmation only when they increase overpaid credit', async () => {
  sqlite.exec("INSERT INTO people VALUES (70, 'Edit test')");
  for (const [id, type, amountMinor, kind] of [
    [70, 'EXPENSE', 1000, 'LEND'],
    [71, 'INCOME', 800, 'RECEIVE_REPAYMENT'],
  ])
    addTransaction(sqlite, {
      id,
      type,
      amountMinor,
      date: 20000,
      accountId: 1,
      lending: { personId: 70, kind },
    });
  try {
    let receipt = await loadEditableTransaction(70);
    await saveTransactionEdit(receipt, '', false, '', [], 900);
    receipt = await loadEditableTransaction(70);
    assert.equal(receipt.amountMinor, 900);
    const warning = await saveTransactionEdit(receipt, 'Changed', false, 'Trip', [], 700);
    assert.equal(warning.status, 'confirmation_required');
    assert.equal(warning.warnings[0].overpaidMinor, 100);
    assert.deepEqual(await loadEditableTransaction(70), receipt);
    await saveTransactionEdit(receipt, 'Changed', false, 'Trip', [], 700, {
      confirmOverpayment: true,
    });
    const edited = await loadEditableTransaction(70);
    assert.equal(edited.amountMinor, 700);
    assert.equal(edited.excludeFromReport, 1);
    assert.deepEqual(
      edited.tags.map((tag) => tag.name),
      ['Trip'],
    );
    assert.equal(edited.note, 'Changed');
  } finally {
    sqlite.exec('DELETE FROM transactions WHERE id IN (70,71); DELETE FROM people WHERE id=70;');
  }
});

test('an amount edit of a split expense updates its leg in place', async () => {
  sqlite.exec("INSERT INTO people VALUES (80, 'Split test')");
  addTransaction(sqlite, { id: 80, type: 'EXPENSE', amountMinor: 1000, date: 20000, accountId: 1 });
  sqlite.exec('INSERT INTO split_shares (expenseId, personId, amountMinor) VALUES (80, 80, 400)');
  const legId = () => sqlite.prepare('SELECT id FROM legs WHERE transactionId = 80').get().id;
  const before = legId();
  try {
    await saveTransactionEdit(await loadEditableTransaction(80), '', false, '', [], 1200);
    assert.equal((await loadEditableTransaction(80)).amountMinor, 1200);
    assert.equal(legId(), before);
  } finally {
    sqlite.exec('DELETE FROM transactions WHERE id = 80; DELETE FROM people WHERE id = 80;');
  }
});
