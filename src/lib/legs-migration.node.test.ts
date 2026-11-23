// Tests the migration from the old schema to the legs model (ADR 0013), and the restore
// of v1 rows with the same fill SQL.
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { resolveSource } from '../test/node-source-resolve.ts';

registerHooks({
  resolve: resolveSource({ 'expo-sqlite': 'test:sqlite', 'expo-file-system': 'test:file' }),
  load(url, context, next) {
    if (url === 'test:sqlite')
      return {
        format: 'module',
        source: 'export const openDatabaseAsync = async () => globalThis.__migrationDb;',
        shortCircuit: true,
      };
    if (url === 'test:file')
      return {
        format: 'module',
        source: `export const Paths = { document: 'documents' };
          export class File {
            constructor(directory, name) { this.path = directory + '/' + name; }
            async write(text) { globalThis.__files.set(this.path, text); }
            get exists() { return globalThis.__files.has(this.path); }
            get size() {
              const bytes = new TextEncoder().encode(globalThis.__files.get(this.path)).length;
              return bytes + globalThis.__fileSizeError;
            }
            delete() { globalThis.__files.delete(this.path); }
          }`,
        shortCircuit: true,
      };
    if (url.endsWith('.ts')) {
      const loaded = next(url, { ...context, format: 'module' });
      return {
        ...loaded,
        format: 'module',
        source: stripTypeScriptTypes(loaded.source.toString()),
        shortCircuit: true,
      };
    }
    return next(url, context);
  },
});
const { decodeBackup } = await import('./backup.ts');
const { legacySchema, legacySnapshot, migrateToLegs, openLedger, restoreLegacyRows } =
  await import('./legs-migration.ts');
const { lendingEntryRows, loadTransaction } = await import('./ledger-store.ts');

/** The expo-sqlite methods that the migration uses, on a node:sqlite database. */
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

/** A database with the old schema and a row of each kind. */
function oldDatabase({ receivedColumn = true } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  sql.exec(legacySchema);
  if (receivedColumn)
    sql.exec(
      'ALTER TABLE transactions ADD COLUMN receivedAmountMinor INTEGER CHECK(receivedAmountMinor > 0)',
    );
  sql.exec(`
    INSERT INTO accounts (id, name, currencyCode, openingBalanceMinor, isFavorite) VALUES
      (1, 'Cash', 'BDT', 1000, 0), (2, 'Wise', 'USD', 0, 1), (3, 'Bank', 'BDT', 0, 0);
    -- Loan has only lending Transactions, so the migration deletes it. Loans also has only
    -- lending Transactions, but its child Family has an Expense, so both stay.
    INSERT INTO categories (id, name, type, parentId, iconKey, needsReview) VALUES
      (1, 'Food', 'EXPENSE', NULL, 'F', 0), (2, 'Loan', 'EXPENSE', NULL, NULL, 1),
      (3, 'Debt', 'INCOME', NULL, NULL, 0), (4, 'Gifts', 'EXPENSE', NULL, NULL, 0),
      (5, 'Flowers', 'EXPENSE', 4, NULL, 0), (6, 'Loans', 'EXPENSE', NULL, NULL, 0),
      (7, 'Family', 'EXPENSE', 6, NULL, 0);
    INSERT INTO people (id, name) VALUES (1, 'Ali'), (2, 'Bina');
    INSERT INTO transactions (id, type, amountMinor, date, accountId, transferAccountId,
      categoryId, note, excludeFromReport, source) VALUES
      (1, 'EXPENSE', 500, 100, 1, NULL, 1, 'lunch', 0, 'MANUAL'),
      (2, 'INCOME', 9000, 101, 1, NULL, 3, NULL, 1, 'IMPORT'),
      (3, 'TRANSFER', 12000, 102, 1, 2, NULL, 'fx', 1, 'MANUAL'),
      (4, 'TRANSFER', 300, 102, 1, 3, NULL, NULL, 0, 'MANUAL'),
      (5, 'EXPENSE', 700, 103, 1, NULL, 2, 'lent', 1, 'MANUAL'),
      (6, 'INCOME', 200, 104, 1, NULL, 3, NULL, 1, 'MANUAL'),
      (7, 'INCOME', 400, 105, 3, NULL, NULL, NULL, 1, 'MANUAL'),
      (8, 'EXPENSE', 100, 106, 3, NULL, 6, NULL, 1, 'MANUAL'),
      (9, 'EXPENSE', 1000, 107, 1, NULL, 7, NULL, 0, 'MANUAL'),
      (10, 'INCOME', 300, 108, 1, NULL, NULL, NULL, 1, 'MANUAL');
    INSERT INTO lending_entries (id, personId, kind, transactionId, currencyCode, amountMinor,
      date, note) VALUES
      (1, 1, 'LEND', 5, 'BDT', 700, 103, 'lent'), (2, 1, 'RECEIVE_REPAYMENT', 6, 'BDT', 200, 104, NULL),
      (3, 2, 'BORROW', 7, 'BDT', 400, 105, NULL), (4, 2, 'REPAY', 8, 'BDT', 100, 106, NULL),
      (5, 1, 'WRITE_OFF_LENT', NULL, 'BDT', 50, 110, 'waived'),
      (6, 2, 'WRITE_OFF_BORROWED', NULL, 'EUR', 20, 111, NULL);
    INSERT INTO split_shares (expenseId, personId, amountMinor) VALUES (9, 1, 400);
    INSERT INTO reimbursements (transactionId, expenseId, personId) VALUES (10, 9, 1);
    INSERT INTO tags (id, name) VALUES (1, 'trip');
    INSERT INTO transaction_tags (transactionId, tagId) VALUES (1, 1);
    INSERT INTO line_items (transactionId, name, amountMinor, quantity) VALUES (1, 'rice', 300, 2);
    INSERT INTO transfer_candidates (outgoingTxnId, incomingTxnId, confidenceNote) VALUES (1, 2, 'x');
    INSERT INTO moneylover_import_rows (rowKey, transactionId) VALUES ('row-1', 2);
    INSERT INTO app_settings (key, value) VALUES
      ('backupSettings', '{"favoriteAccountId":1,"displayRate":{"base":"USD","quote":"BDT","rate":120}}'),
      ('scheduledBackups', '{}'), ('homePeriod', '"month"');`);
  if (receivedColumn) sql.exec('UPDATE transactions SET receivedAmountMinor = 100 WHERE id = 3');
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
const noBackup = async () => assert.fail('A backup is not expected.');

test('the migration moves every old row to the legs model', async () => {
  const sql = oldDatabase();
  const snapshot = await legacySnapshot(connection(sql));
  const backups: string[] = [];
  await openLedger(connection(sql), async (json) => {
    backups.push(json);
  });
  assert.equal(backups.length, 1);
  assert.deepEqual(decodeBackup(backups[0]), snapshot, 'the backup has the old data');
  assert.equal(snapshot.transactions.length, 10);
  assert.equal(snapshot.lendingEntries!.length, 6);

  assert.equal(value(sql, 'PRAGMA user_version'), 1);
  assert.equal(value(sql, 'PRAGMA foreign_keys'), 1);
  assert.equal(value(sql, 'SELECT COUNT(*) FROM sqlite_temp_master'), 0);
  assert.deepEqual(rows(sql, 'PRAGMA foreign_key_check'), []);
  for (const table of ['lending_entries', 'transfer_candidates', 'moneylover_import_rows'])
    assert.equal(value(sql, `SELECT COUNT(*) FROM sqlite_master WHERE name = '${table}'`), 0);
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
      // A Write-off gets the highest old id plus its lending entry id.
      {
        id: 15,
        kind: 'WRITE_OFF',
        direction: 'LENT',
        date: 110,
        categoryId: null,
        note: 'waived',
        excludeFromReport: 0,
      },
      {
        id: 16,
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
      '15: person 1 BDT -50',
      '16: person 2 EUR 20',
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
    snapshot.lendingEntries!.map(({ id, dateEpochDay, ...entry }) => {
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

test('a second run does nothing', async () => {
  const sql = oldDatabase();
  await openLedger(connection(sql), async () => {});
  const after = everything(sql);
  assert.equal(await migrateToLegs(connection(sql)), false);
  await openLedger(connection(sql), noBackup);
  assert.deepEqual(everything(sql), after);
});

test('a failed migration rolls back everything and can run again', async () => {
  const sql = oldDatabase();
  // A Transaction whose Account is missing gets no leg, so the check before COMMIT fails.
  sql.exec(`PRAGMA foreign_keys = OFF;
    INSERT INTO transactions (id, type, amountMinor, date, accountId) VALUES (11, 'EXPENSE', 1, 1, 99);
    PRAGMA foreign_keys = ON;`);
  await openLedger(connection(sql), async () => {}).catch(() => {});
  // openLedger ran the old schema setup, so take the state after it.
  const before = everything(sql);
  await assert.rejects(migrateToLegs(connection(sql)), /a Transaction without legs: 11/);
  assert.deepEqual(everything(sql), before);
  assert.equal(value(sql, 'PRAGMA user_version'), 0);
  assert.equal(value(sql, 'PRAGMA foreign_keys'), 1);
  assert.equal(value(sql, 'SELECT COUNT(*) FROM sqlite_temp_master'), 0);
  assert.equal(sql.isTransaction, false);

  sql.exec('DELETE FROM transactions WHERE id = 11');
  assert.equal(await migrateToLegs(connection(sql)), true);
  assert.equal(value(sql, 'PRAGMA user_version'), 1);
});

test('the favorite comes from the old settings when no Account has the flag', async () => {
  const sql = oldDatabase();
  sql.exec('UPDATE accounts SET isFavorite = 0');
  await openLedger(connection(sql), async () => {});
  assert.equal(value(sql, "SELECT value FROM app_settings WHERE key = 'favoriteAccountId'"), '1');
});

test('the migration removes Line Items and tag links of deleted Transactions', async () => {
  const sql = oldDatabase();
  // The old app deleted on a connection with foreign keys off, so these rows can exist.
  sql.exec(`PRAGMA foreign_keys = OFF;
    INSERT INTO line_items (transactionId, name, amountMinor) VALUES (40, 'left', 1);
    INSERT INTO transaction_tags (transactionId, tagId) VALUES (40, 1), (2, 9);
    PRAGMA foreign_keys = ON;`);
  await openLedger(connection(sql), async () => {});
  assert.equal(value(sql, 'PRAGMA user_version'), 1);
  assert.deepEqual(rows(sql, 'SELECT transactionId, name FROM line_items'), [
    { transactionId: 1, name: 'rice' },
  ]);
  assert.deepEqual(rows(sql, 'SELECT * FROM transaction_tags'), [{ transactionId: 1, tagId: 1 }]);
});

test('a foreign key that the migration cannot repair stops it', async () => {
  const sql = oldDatabase();
  sql.exec(`PRAGMA foreign_keys = OFF;
    INSERT INTO credit_cards (accountId, parentAccountId) VALUES (2, 77);
    PRAGMA foreign_keys = ON;`);
  // The backup check before the migration also refuses this data.
  await assert.rejects(
    openLedger(connection(sql), async () => {}),
    /credit-card parent/,
  );
  await assert.rejects(migrateToLegs(connection(sql)), /Foreign key violations/);
  assert.equal(value(sql, 'PRAGMA user_version'), 0);
  assert.equal(value(sql, 'SELECT COUNT(*) FROM lending_entries'), 6);
});

test('no migration runs when the backup fails', async () => {
  const sql = oldDatabase();
  await assert.rejects(
    openLedger(connection(sql), async () => {
      throw new Error('disk full');
    }),
    /disk full/,
  );
  assert.equal(value(sql, 'PRAGMA user_version'), 0);
  assert.equal(value(sql, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'lending_entries'"), 1);
  assert.equal(value(sql, 'SELECT COUNT(*) FROM transactions'), 10);
});

test('an install from before received amounts gets the column, then the migration', async () => {
  const sql = oldDatabase({ receivedColumn: false });
  await openLedger(connection(sql), async () => {});
  assert.deepEqual(rows(sql, 'SELECT accountId, amountMinor FROM legs WHERE transactionId = 3'), [
    { accountId: 1, amountMinor: -12000 },
    { accountId: 2, amountMinor: 12000 },
  ]);
});

test('a new install gets the legs schema without a backup', async () => {
  const sql = new DatabaseSync(':memory:');
  await openLedger(connection(sql), noBackup);
  assert.equal(value(sql, 'PRAGMA user_version'), 1);
  assert.equal(value(sql, 'PRAGMA foreign_keys'), 1);
  assert.equal(value(sql, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'legs'"), 1);
  assert.equal(value(sql, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'lending_entries'"), 0);
});

test('a restore of the old rows gives the same data as the migration', async () => {
  const migrated = oldDatabase();
  const snapshot = await legacySnapshot(connection(migrated));
  await openLedger(connection(migrated), async () => {});
  const restored = new DatabaseSync(':memory:');
  await openLedger(connection(restored), noBackup);
  await connection(restored).withExclusiveTransactionAsync((tx: never) =>
    restoreLegacyRows(tx, snapshot),
  );
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
  assert.deepEqual(data(restored), data(migrated));
});

test('database() writes the backup file, checks its size, then migrates', async (t) => {
  t.after(() => {
    for (const name of ['__migrationDb', '__files', '__fileSizeError'])
      delete (globalThis as Record<string, unknown>)[name];
  });
  const sql = oldDatabase();
  const files = new Map<string, string>();
  Object.assign(globalThis, {
    __migrationDb: connection(sql),
    __files: files,
    __fileSizeError: 1,
  });
  const { database } = await import('./database.ts');
  await assert.rejects(database(), /Could not save the backup/);
  assert.equal(value(sql, 'PRAGMA user_version'), 0, 'a short file stops the migration');

  Object.assign(globalThis, { __fileSizeError: 0 });
  await database();
  assert.equal(value(sql, 'PRAGMA user_version'), 1);
  const json = files.get('documents/expense-backup-before-legs-migration.json')!;
  assert.equal(decodeBackup(json).transactions.length, 10);

  const { removePreMigrationBackup } = await import('./pre-migration-backup.ts');
  removePreMigrationBackup();
  assert.equal(files.size, 0);
});
