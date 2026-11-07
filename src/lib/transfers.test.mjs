import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '', currencyCode TEXT NOT NULL);
CREATE TABLE transactions (id INTEGER PRIMARY KEY, type TEXT NOT NULL, amountMinor INTEGER NOT NULL CHECK(amountMinor > 0), date INTEGER NOT NULL, accountId INTEGER NOT NULL REFERENCES accounts(id), transferAccountId INTEGER REFERENCES accounts(id), categoryId INTEGER, note TEXT);
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE transaction_tags (transactionId INTEGER REFERENCES transactions(id), tagId INTEGER REFERENCES tags(id));
INSERT INTO accounts VALUES (1, 'Cash', 'BDT'), (2, 'Bank', 'BDT'), (3, 'Card', 'USD'), (4, 'Wallet', 'BDT');`);
const tx = {
  getFirstAsync: async (sql, params) => sqlite.prepare(sql).get(...params) ?? null,
  getAllAsync: async (sql, params) => sqlite.prepare(sql).all(...params),
  runAsync: async (sql, params) => {
    const result = sqlite.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  },
};
globalThis.__transferTestDb = {
  ...tx,
  withExclusiveTransactionAsync: async (callback) => {
    sqlite.exec('BEGIN');
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
    if (specifier === './tag-store') return next('./tag-store.ts', context);
    if (specifier === './database') return { url: 'test:database', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:database')
      return {
        format: 'module',
        source:
          'export const database = async () => globalThis.__transferTestDb; export const epochDay = (date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);',
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
const { addTransfer, loadTransfer, saveTransferEdit } = await import('./transfers.ts');

test('saves one same-currency transfer with a local date and no category', async () => {
  await addTransfer({ amountMinor: 1234, fromAccountId: 1, toAccountId: 2, note: '  rent  ' });
  const rows = sqlite
    .prepare(
      'SELECT type, amountMinor, date, accountId, transferAccountId, categoryId, note FROM transactions',
    )
    .all();
  const today = new Date();
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [
      {
        type: 'TRANSFER',
        amountMinor: 1234,
        date: Math.floor(
          Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000,
        ),
        accountId: 1,
        transferAccountId: 2,
        categoryId: null,
        note: 'rent',
      },
    ],
  );
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

function insertTransfer() {
  return Number(
    sqlite
      .prepare(
        `INSERT INTO transactions (type, amountMinor, date, accountId, transferAccountId, categoryId, note)
    VALUES ('TRANSFER', 500, 20000, 1, 2, NULL, 'move')`,
      )
      .run().lastInsertRowid,
  );
}

test('loads a transfer with both account names and nothing else', async () => {
  const id = insertTransfer();
  const expense = Number(
    sqlite
      .prepare(
        `INSERT INTO transactions (type, amountMinor, date, accountId) VALUES ('EXPENSE', 1, 20000, 1)`,
      )
      .run().lastInsertRowid,
  );
  assert.deepEqual(
    { ...(await loadTransfer(id)) },
    {
      id,
      type: 'TRANSFER',
      amountMinor: 500,
      date: 20000,
      fromAccountId: 1,
      fromAccountName: 'Cash',
      toAccountId: 2,
      toAccountName: 'Bank',
      currencyCode: 'BDT',
      note: 'move',
    },
  );
  assert.equal(await loadTransfer(expense), null);
  assert.equal(await loadTransfer(99999), null);
});

test('saves edited amount, accounts, date and note', async () => {
  const id = insertTransfer();
  const original = await loadTransfer(id);
  await saveTransferEdit(original, {
    amountMinor: 750,
    fromAccountId: 4,
    toAccountId: 1,
    date: 19990,
    note: '  rent  ',
  });
  assert.deepEqual(
    {
      ...sqlite
        .prepare(
          'SELECT type, amountMinor, date, accountId, transferAccountId, categoryId, note FROM transactions WHERE id = ?',
        )
        .get(id),
    },
    {
      type: 'TRANSFER',
      amountMinor: 750,
      date: 19990,
      accountId: 4,
      transferAccountId: 1,
      categoryId: null,
      note: 'rent',
    },
  );
  await saveTransferEdit(await loadTransfer(id), {
    amountMinor: 750,
    fromAccountId: 4,
    toAccountId: 1,
    date: 19990,
    note: '  ',
  });
  assert.equal(sqlite.prepare('SELECT note FROM transactions WHERE id = ?').get(id).note, null);
});

test('rejects invalid transfer edits and stale originals without changes', async () => {
  const id = insertTransfer();
  const original = await loadTransfer(id);
  const row = () => ({ ...sqlite.prepare('SELECT * FROM transactions WHERE id = ?').get(id) });
  const before = row();
  const valid = { amountMinor: 600, fromAccountId: 1, toAccountId: 2, date: 20000, note: null };
  for (const input of [
    { ...valid, amountMinor: 0 },
    { ...valid, amountMinor: 1.5 },
    { ...valid, toAccountId: 1 },
    { ...valid, toAccountId: 3 },
    { ...valid, toAccountId: 999 },
    { ...valid, date: 1.5 },
    { ...valid, date: -1 },
  ]) {
    await assert.rejects(() => saveTransferEdit(original, input));
    assert.deepEqual(row(), before);
  }
  sqlite.prepare('UPDATE transactions SET amountMinor = 501 WHERE id = ?').run(id);
  await assert.rejects(() => saveTransferEdit(original, valid), /changed or removed/);
  assert.equal(row().amountMinor, 501);
});

test('quick transfer keeps the chosen day and tags, and rejects invalid drafts atomically', async () => {
  await addTransfer({
    amountMinor: 325,
    fromAccountId: 1,
    toAccountId: 2,
    date: new Date(2020, 0, 1, 23, 30),
    note: null,
    tagText: ' Travel, travel ',
  });
  const rows = sqlite
    .prepare(
      'SELECT t.date, tags.name FROM transactions t JOIN transaction_tags tt ON tt.transactionId=t.id JOIN tags ON tags.id=tt.tagId WHERE t.amountMinor=325',
    )
    .all();
  assert.deepEqual(
    rows.map((r) => ({ ...r })),
    [{ date: 18262, name: 'Travel' }],
  );
  const count = () => sqlite.prepare('SELECT count(*) AS n FROM transactions').get().n;
  const before = count();
  const future = new Date();
  future.setDate(future.getDate() + 1);
  for (const extra of [{ tagText: 'bad,' }, { date: future }, { date: new Date('invalid') }]) {
    await assert.rejects(() =>
      addTransfer({ amountMinor: 325, fromAccountId: 1, toAccountId: 2, note: null, ...extra }),
    );
    assert.equal(count(), before);
  }
  sqlite.exec(
    "CREATE TRIGGER fail_transfer_tags BEFORE INSERT ON transaction_tags BEGIN SELECT RAISE(ABORT, 'tag failure'); END;",
  );
  await assert.rejects(
    () =>
      addTransfer({
        amountMinor: 325,
        fromAccountId: 1,
        toAccountId: 2,
        note: null,
        tagText: 'Rollback',
      }),
    /tag failure/,
  );
  sqlite.exec('DROP TRIGGER fail_transfer_tags');
  assert.equal(count(), before);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM tags WHERE name='Rollback'").get().n, 0);
});
