// Tests the restore of a v1 backup into the legs model (ADR 0013, ADR 0014): the cleaning
// of rows that the old app left after a delete, and the fill of the legs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { BackupV1 } from './backup-v1.ts';
import { decodeBackup } from './backup.ts';
import { restoreLegacyRows } from './backup-v1-restore.ts';
import { lendingEntryRows, loadTransaction } from './ledger-store.ts';
import { openLedger } from './legs-schema.ts';

/** The expo-sqlite methods that the restore uses, on a node:sqlite database. */
function connection(sql: DatabaseSync) {
  const db = {
    execAsync: async (query: string) => sql.exec(query),
    runAsync: async (query: string, params: unknown[] = []) => {
      const result = sql.prepare(query).run(...(params as never[]));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    getAllAsync: async (query: string, params: unknown[] = []) =>
      sql
        .prepare(query)
        .all(...(params as never[]))
        .map((row) => ({ ...row })),
    getFirstAsync: async (query: string, params: unknown[] = []) => {
      const row = sql.prepare(query).get(...(params as never[]));
      return row ? { ...row } : null;
    },
    isInTransactionSync: () => sql.isTransaction,
    async withExclusiveTransactionAsync(callback: (tx: typeof db) => Promise<void>) {
      sql.exec('BEGIN');
      try {
        await callback(db);
        sql.exec('COMMIT');
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return db as never;
}

/** A v1 backup with a row of each kind. */
const oldBackup = (): BackupV1 =>
  JSON.parse(
    readFileSync(
      new URL('../../scripts/fixtures/backup-v1-every-kind.json', import.meta.url),
      'utf8',
    ),
  );

/** A database with the legs schema and one device-local setting. */
async function newDatabase() {
  const sql = new DatabaseSync(':memory:');
  await openLedger(connection(sql));
  sql.exec(`INSERT INTO app_settings (key, value) VALUES ('homePeriod', '"month"')`);
  return sql;
}

/** Restores the backup as the app does: decode the file, then replace in a transaction. */
function restore(sql: DatabaseSync, backup: BackupV1) {
  const data = decodeBackup(JSON.stringify(backup)) as BackupV1;
  return connection(sql).withExclusiveTransactionAsync((tx: never) => restoreLegacyRows(tx, data));
}

/** The data after a restore of the backup into a new database. */
async function restored(backup: BackupV1) {
  const sql = await newDatabase();
  await restore(sql, backup);
  return sql;
}

const rows = (sql: DatabaseSync, query: string) =>
  sql
    .prepare(query)
    .all()
    .map((row) => ({ ...row }));
const value = (sql: DatabaseSync, query: string) => Object.values(sql.prepare(query).get()!)[0];
/** The whole database: the schema and every row of every table. */
function everything(sql: DatabaseSync) {
  const tables = rows(sql, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  return {
    schema: rows(sql, 'SELECT type, name, sql FROM sqlite_master ORDER BY type, name'),
    rows: tables.map(({ name }) => rows(sql, `SELECT * FROM "${name}" ORDER BY 1, 2`)),
    version: value(sql, 'PRAGMA user_version'),
  };
}
/** The data of a database with the legs schema, without leg ids. */
const data = (sql: DatabaseSync) => ({
  ...Object.fromEntries(
    [
      'accounts',
      'categories',
      'transactions',
      'tags',
      'transaction_tags',
      'line_items',
      'people',
      'split_shares',
      'reimbursements',
      'credit_cards',
    ].map((table) => [table, rows(sql, `SELECT * FROM ${table} ORDER BY 1, 2`)]),
  ),
  legs: rows(
    sql,
    'SELECT transactionId, accountId, personId, currencyCode, amountMinor FROM legs ORDER BY 1, 2, 3',
  ),
  settings: rows(
    sql,
    "SELECT * FROM app_settings WHERE key IN ('favoriteAccountId', 'displayRate') ORDER BY key",
  ),
});

test('a v1 restore moves every old row to the legs model', async () => {
  const backup = oldBackup();
  const sql = await restored(backup);
  assert.equal(value(sql, 'SELECT COUNT(*) FROM sqlite_temp_master'), 0);
  assert.deepEqual(rows(sql, 'PRAGMA foreign_key_check'), []);
  assert.deepEqual(
    rows(
      sql,
      'SELECT id, kind, direction, date, categoryId, note, excludeFromReport FROM transactions',
    ),
    [
      {
        id: 1,
        kind: 'EXPENSE',
        direction: null,
        date: 100,
        categoryId: 1,
        note: 'lunch',
        excludeFromReport: 0,
      },
      {
        id: 2,
        kind: 'INCOME',
        direction: null,
        date: 101,
        categoryId: 3,
        note: null,
        excludeFromReport: 1,
      },
      {
        id: 3,
        kind: 'TRANSFER',
        direction: null,
        date: 102,
        categoryId: null,
        note: 'fx',
        excludeFromReport: 0,
      },
      {
        id: 4,
        kind: 'TRANSFER',
        direction: null,
        date: 102,
        categoryId: null,
        note: null,
        excludeFromReport: 0,
      },
      {
        id: 5,
        kind: 'LENDING',
        direction: 'LENT',
        date: 103,
        categoryId: null,
        note: 'lent',
        excludeFromReport: 0,
      },
      {
        id: 6,
        kind: 'LENDING',
        direction: 'LENT',
        date: 104,
        categoryId: null,
        note: null,
        excludeFromReport: 0,
      },
      {
        id: 7,
        kind: 'LENDING',
        direction: 'BORROWED',
        date: 105,
        categoryId: null,
        note: null,
        excludeFromReport: 0,
      },
      {
        id: 8,
        kind: 'LENDING',
        direction: 'BORROWED',
        date: 106,
        categoryId: null,
        note: null,
        excludeFromReport: 0,
      },
      {
        id: 9,
        kind: 'EXPENSE',
        direction: null,
        date: 107,
        categoryId: 7,
        note: null,
        excludeFromReport: 0,
      },
      {
        id: 10,
        kind: 'REIMBURSEMENT',
        direction: null,
        date: 108,
        categoryId: null,
        note: null,
        excludeFromReport: 1,
      },
      // Write-offs get the next ids after the highest old id, in lending entry order.
      {
        id: 11,
        kind: 'WRITE_OFF',
        direction: 'LENT',
        date: 110,
        categoryId: null,
        note: 'waived',
        excludeFromReport: 0,
      },
      {
        id: 12,
        kind: 'WRITE_OFF',
        direction: 'BORROWED',
        date: 111,
        categoryId: null,
        note: null,
        excludeFromReport: 0,
      },
    ],
  );
  assert.deepEqual(
    rows(
      sql,
      `SELECT transactionId AS t, accountId AS a, personId AS p, currencyCode AS c, amountMinor AS m
      FROM legs ORDER BY transactionId, personId IS NOT NULL, amountMinor`,
    ).map(({ t, a, p, c, m }) => `${t}: ${a ? `account ${a}` : `person ${p}`} ${c} ${m}`),
    [
      '1: account 1 BDT -500',
      '2: account 1 BDT 9000',
      '3: account 1 BDT -12000',
      '3: account 2 USD 100',
      '4: account 1 BDT -300',
      '4: account 3 BDT 300',
      '5: account 1 BDT -700',
      '5: person 1 BDT 700',
      '6: account 1 BDT 200',
      '6: person 1 BDT -200',
      '7: account 3 BDT 400',
      '7: person 2 BDT -400',
      '8: account 3 BDT -100',
      '8: person 2 BDT 100',
      '9: account 1 BDT -1000',
      '10: account 1 BDT 300',
      '11: person 1 BDT -50',
      '12: person 2 EUR 20',
    ],
  );
  const db = connection(sql);
  for (const { id } of rows(sql, 'SELECT id FROM transactions'))
    assert.ok(await loadTransaction(db, id as number), `Transaction ${id} has a valid shape`);
  assert.deepEqual(
    rows(sql, 'SELECT id FROM categories').map((row) => row.id),
    [1, 3, 4, 5, 6, 7],
    'only the category that only lending used goes away',
  );
  assert.deepEqual(rows(sql, 'SELECT * FROM app_settings ORDER BY key'), [
    { key: 'displayRate', value: '{"base":"USD","quote":"BDT","rate":120}' },
    { key: 'favoriteAccountId', value: '2' },
    { key: 'homePeriod', value: '"month"' },
  ]);
  assert.deepEqual(rows(sql, 'SELECT * FROM reimbursements'), [
    { transactionId: 10, expenseId: 9, personId: 1 },
  ]);
  assert.deepEqual(
    rows(sql, `${lendingEntryRows} ORDER BY t.id`).map(({ id, ...entry }) => entry),
    backup.lendingEntries!.map(({ id, dateEpochDay, ...entry }) => {
      // Transactions 5 and 6 use Cash, 7 and 8 use Bank, and a Write-off has no Account.
      const account = { 5: [1, 'Cash'], 6: [1, 'Cash'], 7: [3, 'Bank'], 8: [3, 'Bank'] }[
        entry.transactionId as 5 | 6 | 7 | 8
      ] ?? [null, null];
      return {
        ...entry,
        personName: entry.personId === 1 ? 'Ali' : 'Bina',
        date: dateEpochDay,
        accountId: account[0],
        accountName: account[1],
      };
    }),
    'the lending entries read back with their six kinds',
  );
});

test('a failed v1 restore rolls back everything', async () => {
  const sql = await restored(oldBackup());
  const before = everything(sql);
  const backup = oldBackup();
  const last = Number.MAX_SAFE_INTEGER - 1;
  backup.transactions.find((row) => row.id === 10)!.id = last;
  backup.reimbursements![0].transactionId = last;
  // The two Write-offs get the next two ids, and the second id is too large. The check runs
  // after the restore deleted the live rows.
  await assert.rejects(restore(sql, backup), /Transaction id that is too large/);
  assert.deepEqual(everything(sql), before);
  assert.equal(sql.isTransaction, false);
});

test('the favorite comes from the settings of the file when no Account has the flag', async () => {
  const backup = oldBackup();
  for (const account of backup.accounts) account.isFavorite = false;
  const sql = await restored(backup);
  assert.equal(value(sql, "SELECT value FROM app_settings WHERE key = 'favoriteAccountId'"), '1');
});

test('rows that the old app left after a delete do not stop or change the restore', async () => {
  // The repaired rows: what the foreign key actions of the old schema would have left.
  const expected = oldBackup();
  expected.transactions[0].categoryId = null;
  const orphan = { id: 8, name: 'Orphan', type: 'EXPENSE', iconKey: null, needsReview: false };
  expected.categories.push({ ...orphan, parentId: null });
  expected.creditCards = [
    { accountId: 3, parentAccountId: null, statementDay: null, dueDay: null },
  ];
  // The old app deleted on a connection with foreign keys off, so these rows can exist.
  // Transaction 11 was deleted, and its id is the id that the first Write-off gets.
  const actual = oldBackup();
  actual.transactions[0].categoryId = 98;
  actual.categories.push({ ...orphan, parentId: 99 });
  actual.creditCards = [
    { accountId: 3, parentAccountId: 77, statementDay: null, dueDay: null },
    { accountId: 99, parentAccountId: 1, statementDay: null, dueDay: null },
  ];
  actual.lineItems.push({ id: 2, transactionId: 11, name: 'left', amountMinor: 1, quantity: null });
  actual.transactionTags.push({ transactionId: 11, tagId: 1 }, { transactionId: 1, tagId: 9 });
  actual.moneyLoverImportRows!.push({ rowKey: 'gone', transactionId: 11 });
  actual.lendingEntries!.push({
    id: 7,
    personId: 1,
    kind: 'LEND',
    transactionId: 11,
    currencyCode: 'BDT',
    amountMinor: 5,
    dateEpochDay: 100,
    note: null,
  });
  actual.splitShares!.push({ expenseId: 11, personId: 2, amountMinor: 50 });
  actual.reimbursements!.push(
    { transactionId: 11, expenseId: 9, personId: 1 },
    { transactionId: 2, expenseId: 9, personId: 2 },
  );
  const sql = await restored(actual);
  assert.deepEqual(data(sql), data(await restored(expected)));
  assert.equal(value(sql, 'SELECT kind FROM transactions WHERE id = 11'), 'WRITE_OFF');
  assert.equal(value(sql, 'SELECT COUNT(*) FROM line_items WHERE transactionId = 11'), 0);
  // The card parent was only the default source for a settlement, so it becomes no parent.
  assert.equal(value(sql, 'SELECT parentAccountId FROM credit_cards WHERE accountId = 3'), null);
});

test('tags whose names differ only by case become one tag', async () => {
  const backup = oldBackup();
  backup.tags.push({ id: 2, name: 'Trip' }, { id: 3, name: 'TRIP' });
  backup.transactionTags.push(
    { transactionId: 1, tagId: 3 },
    { transactionId: 2, tagId: 2 },
    { transactionId: 4, tagId: 3 },
  );
  const sql = await restored(backup);
  assert.deepEqual(rows(sql, 'SELECT * FROM tags'), [{ id: 1, name: 'trip' }]);
  assert.deepEqual(rows(sql, 'SELECT * FROM transaction_tags ORDER BY transactionId'), [
    { transactionId: 1, tagId: 1 },
    { transactionId: 2, tagId: 1 },
    { transactionId: 4, tagId: 1 },
  ]);
});

test('a missing Account or person that a Leg or a share needs stops the restore', async () => {
  // The app has no delete for Accounts and people, so these rows are damaged data.
  const cases: [(backup: BackupV1) => void, RegExp][] = [
    [(b) => (b.transactions[0].accountId = 99), /Row 1 of transactions needs Account 99/],
    [
      (b) => (b.transactions[3].transferAccountId = 98),
      /Row 4 of transactions needs destination Account 98/,
    ],
    [(b) => (b.lendingEntries![4].personId = 97), /Row 5 of lending_entries needs person 97/],
    [
      (b) => b.splitShares!.push({ expenseId: 1, personId: 96, amountMinor: 10 }),
      /Row 1 of split_shares needs person 96/,
    ],
  ];
  const sql = await restored(oldBackup());
  const before = everything(sql);
  for (const [damage, error] of cases) {
    const backup = oldBackup();
    damage(backup);
    await assert.rejects(restore(sql, backup), error);
    assert.deepEqual(everything(sql), before);
  }
});

test('the destination of a row that is not a Transfer is cleared', async () => {
  const backup = oldBackup();
  backup.transactions[0].transferAccountId = 99;
  assert.deepEqual(data(await restored(backup)), data(await restored(oldBackup())));
});

test('a restore checks the staged rows before it deletes any live row', async () => {
  const sql = await restored(oldBackup());
  const before = data(sql);
  const broken = oldBackup();
  broken.transactions[0].accountId = 99;
  // No transaction wraps this call, so a delete before the check would stay.
  await assert.rejects(
    restoreLegacyRows(connection(sql), broken),
    /Row 1 of transactions needs Account 99/,
  );
  assert.deepEqual(data(sql), before);
});
