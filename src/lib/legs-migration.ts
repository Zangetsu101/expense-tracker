// The move from the old schema to the legs model (ADR 0013), and the restore of v1 backup
// rows. Both put old rows in TEMP tables named legacy_* and run the same fill SQL, so the
// migration and the restore share one mapping.
import type { SQLiteDatabase } from 'expo-sqlite';
import { encodeBackup, type BackupData } from './backup.ts';
import { LEGS_SCHEMA_VERSION, legsSchema } from './legs-schema.ts';
import { readAll } from './read-all.ts';

type Connection = Pick<SQLiteDatabase, 'execAsync' | 'getAllAsync' | 'getFirstAsync'>;
type MainConnection = Connection & Pick<SQLiteDatabase, 'isInTransactionSync'>;

/**
 * The setup of the old schema, from the last version before the legs model. The migration
 * runs it first, so that every old table and column exists, also on old installs. The last
 * old version added receivedAmountMinor with ALTER TABLE, so this SQL does not have it.
 */
export const legacySchema = `
CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, currencyCode TEXT NOT NULL, openingBalanceMinor INTEGER NOT NULL DEFAULT 0, isFavorite INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, parentId INTEGER REFERENCES categories(id) ON DELETE SET NULL, iconKey TEXT, needsReview INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, type TEXT NOT NULL, amountMinor INTEGER NOT NULL CHECK(amountMinor > 0), date INTEGER NOT NULL, accountId INTEGER NOT NULL REFERENCES accounts(id), transferAccountId INTEGER REFERENCES accounts(id), categoryId INTEGER REFERENCES categories(id) ON DELETE SET NULL, note TEXT, excludeFromReport INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'MANUAL');
CREATE TABLE IF NOT EXISTS line_items (id INTEGER PRIMARY KEY, transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, name TEXT NOT NULL, amountMinor INTEGER NOT NULL, quantity REAL);
CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS transaction_tags (transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(transactionId, tagId));
CREATE TABLE IF NOT EXISTS transfer_candidates (id INTEGER PRIMARY KEY, outgoingTxnId INTEGER NOT NULL, incomingTxnId INTEGER NOT NULL, confidenceNote TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS moneylover_import_rows (rowKey TEXT PRIMARY KEY, transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0));
CREATE TABLE IF NOT EXISTS lending_entries (id INTEGER PRIMARY KEY, personId INTEGER NOT NULL REFERENCES people(id), kind TEXT NOT NULL CHECK(kind IN ('LEND','BORROW','RECEIVE_REPAYMENT','REPAY','WRITE_OFF_LENT','WRITE_OFF_BORROWED')), transactionId INTEGER UNIQUE REFERENCES transactions(id) ON DELETE CASCADE, currencyCode TEXT NOT NULL, amountMinor INTEGER NOT NULL CHECK(amountMinor > 0), date INTEGER NOT NULL, note TEXT, CHECK((kind IN ('WRITE_OFF_LENT','WRITE_OFF_BORROWED') AND transactionId IS NULL) OR (kind IN ('LEND','BORROW','RECEIVE_REPAYMENT','REPAY') AND transactionId IS NOT NULL)));
CREATE TABLE IF NOT EXISTS credit_cards (accountId INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, parentAccountId INTEGER REFERENCES accounts(id), statementDay INTEGER CHECK(statementDay BETWEEN 1 AND 31), dueDay INTEGER CHECK(dueDay BETWEEN 1 AND 31), CHECK(accountId != parentAccountId));
CREATE TABLE IF NOT EXISTS split_shares (expenseId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, personId INTEGER NOT NULL REFERENCES people(id), amountMinor INTEGER NOT NULL CHECK(amountMinor >= 0), PRIMARY KEY(expenseId, personId));
CREATE TABLE IF NOT EXISTS reimbursements (transactionId INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE, expenseId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, personId INTEGER, FOREIGN KEY(expenseId, personId) REFERENCES split_shares(expenseId, personId) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

/**
 * The columns of the old tables that the fill SQL reads, with their types. A restore fills
 * TEMP tables of these shapes from a backup. The types give the columns the same affinity
 * as the old tables, so a number from JavaScript is stored as an INTEGER.
 */
const legacyTables = {
  accounts: {
    id: 'INTEGER',
    name: 'TEXT',
    currencyCode: 'TEXT',
    openingBalanceMinor: 'INTEGER',
    isFavorite: 'INTEGER',
  },
  categories: { id: 'INTEGER', name: 'TEXT', type: 'TEXT', parentId: 'INTEGER', iconKey: 'TEXT' },
  transactions: {
    id: 'INTEGER',
    type: 'TEXT',
    amountMinor: 'INTEGER',
    receivedAmountMinor: 'INTEGER',
    date: 'INTEGER',
    accountId: 'INTEGER',
    transferAccountId: 'INTEGER',
    categoryId: 'INTEGER',
    note: 'TEXT',
    excludeFromReport: 'INTEGER',
  },
  tags: { id: 'INTEGER', name: 'TEXT' },
  lending_entries: {
    id: 'INTEGER',
    personId: 'INTEGER',
    kind: 'TEXT',
    transactionId: 'INTEGER',
    currencyCode: 'TEXT',
    amountMinor: 'INTEGER',
    date: 'INTEGER',
    note: 'TEXT',
  },
  reimbursements: { transactionId: 'INTEGER', expenseId: 'INTEGER', personId: 'INTEGER' },
  app_settings: { key: 'TEXT', value: 'TEXT' },
};
type LegacyTable = keyof typeof legacyTables;
const legacyNames = Object.keys(legacyTables) as LegacyTable[];
/** The old tables that the legs schema replaces. The other old tables stay as they are. */
const replacedTables = [
  'accounts',
  'categories',
  'transactions',
  'tags',
  'lending_entries',
  'transfer_candidates',
  'moneylover_import_rows',
];

// Write-offs get new Transaction ids after the highest old id, in lending entry order.
const writeOffId = '(SELECT COALESCE(MAX(id), 0) FROM legacy_transactions) + e.id';

/**
 * Fills the legs schema from the legacy_* TEMP tables. The main tables people, split_shares
 * and the device-local rows of app_settings must already hold their rows. The mapping is
 * the spec in the ADR: each old Transaction keeps its id, lending entries become legs, and
 * each write-off becomes a Transaction.
 */
const fillFromLegacy = `
INSERT INTO accounts (id, name, currencyCode, openingBalanceMinor)
  SELECT id, name, currencyCode, openingBalanceMinor FROM legacy_accounts;

-- Keep a category unless only lending Transactions use it. A category with a kept child
-- is also kept, so the rule works up the tree.
WITH RECURSIVE usage AS (
  SELECT c.id, c.parentId,
    EXISTS (SELECT 1 FROM legacy_transactions t
      JOIN legacy_lending_entries e ON e.transactionId = t.id WHERE t.categoryId = c.id) AS lending,
    EXISTS (SELECT 1 FROM legacy_transactions t
      LEFT JOIN legacy_lending_entries e ON e.transactionId = t.id
      WHERE t.categoryId = c.id AND e.id IS NULL) AS other
  FROM legacy_categories c),
kept(id) AS (
  SELECT id FROM usage WHERE NOT lending OR other
  UNION SELECT u.parentId FROM usage u JOIN kept ON kept.id = u.id WHERE u.parentId IS NOT NULL)
INSERT INTO categories (id, name, type, parentId, iconKey)
  SELECT id, name, type, parentId, iconKey FROM legacy_categories
  WHERE id IN (SELECT id FROM kept);

INSERT INTO tags (id, name) SELECT id, name FROM legacy_tags;

INSERT INTO transactions (id, kind, direction, date, categoryId, note, excludeFromReport)
  SELECT t.id,
    CASE WHEN e.id IS NOT NULL THEN 'LENDING'
      WHEN r.transactionId IS NOT NULL THEN 'REIMBURSEMENT' ELSE t.type END,
    CASE WHEN e.kind IN ('LEND', 'RECEIVE_REPAYMENT') THEN 'LENT'
      WHEN e.kind IN ('BORROW', 'REPAY') THEN 'BORROWED' END,
    t.date,
    CASE WHEN e.id IS NULL AND r.transactionId IS NULL AND t.type <> 'TRANSFER'
      THEN t.categoryId END,
    t.note,
    CASE WHEN e.id IS NULL AND t.type <> 'TRANSFER' THEN t.excludeFromReport ELSE 0 END
  FROM legacy_transactions t
  LEFT JOIN legacy_lending_entries e ON e.transactionId = t.id
  LEFT JOIN legacy_reimbursements r ON r.transactionId = t.id;

INSERT INTO transactions (id, kind, direction, date, note)
  SELECT ${writeOffId}, 'WRITE_OFF',
    CASE WHEN e.kind = 'WRITE_OFF_LENT' THEN 'LENT' ELSE 'BORROWED' END, e.date, e.note
  FROM legacy_lending_entries e WHERE e.transactionId IS NULL;

-- The Account leg of every old Transaction.
INSERT INTO legs (transactionId, accountId, currencyCode, amountMinor)
  SELECT t.id, t.accountId, a.currencyCode,
    CASE WHEN t.type = 'INCOME' THEN t.amountMinor ELSE -t.amountMinor END
  FROM legacy_transactions t JOIN accounts a ON a.id = t.accountId ORDER BY t.id;

-- The destination leg of a Transfer (ADR 0010).
INSERT INTO legs (transactionId, accountId, currencyCode, amountMinor)
  SELECT t.id, t.transferAccountId, b.currencyCode, COALESCE(t.receivedAmountMinor, t.amountMinor)
  FROM legacy_transactions t JOIN accounts b ON b.id = t.transferAccountId
  WHERE t.type = 'TRANSFER' ORDER BY t.id;

-- The Person leg of a linked lending entry has the opposite sign of its Account leg.
INSERT INTO legs (transactionId, personId, currencyCode, amountMinor)
  SELECT t.id, e.personId, a.currencyCode,
    CASE WHEN t.type = 'EXPENSE' THEN t.amountMinor ELSE -t.amountMinor END
  FROM legacy_lending_entries e
  JOIN legacy_transactions t ON t.id = e.transactionId
  JOIN accounts a ON a.id = t.accountId ORDER BY t.id;

-- A write-off has only a Person leg.
INSERT INTO legs (transactionId, personId, currencyCode, amountMinor)
  SELECT ${writeOffId}, e.personId, e.currencyCode,
    CASE WHEN e.kind = 'WRITE_OFF_LENT' THEN -e.amountMinor ELSE e.amountMinor END
  FROM legacy_lending_entries e WHERE e.transactionId IS NULL ORDER BY e.id;

-- One row for each portable setting. Device-local rows stay as they are.
-- The favorite comes from the account flag, or else from the old settings JSON.
DELETE FROM app_settings
  WHERE key IN ('backupSettings', 'scheduledBackups', 'favoriteAccountId', 'displayRate');
INSERT INTO app_settings (key, value)
  SELECT 'favoriteAccountId', json(id) FROM (
    SELECT id, 0 AS rank FROM legacy_accounts WHERE isFavorite = 1
    UNION ALL
    SELECT a.id, 1 FROM legacy_app_settings s
    JOIN legacy_accounts a ON a.id = json_extract(s.value, '$.favoriteAccountId')
    WHERE s.key = 'backupSettings')
  ORDER BY rank, id LIMIT 1;
INSERT INTO app_settings (key, value)
  SELECT 'displayRate', json_extract(value, '$.displayRate') FROM legacy_app_settings
  WHERE key = 'backupSettings' AND json_extract(value, '$.displayRate') IS NOT NULL;
`;

// The old app wrote on Expo's connection for exclusive writes, where foreign keys are off.
// So a deleted Transaction could leave its Line Items and tag links, which ON DELETE
// CASCADE would have removed. Old backups can have these rows too. Remove them before the
// check of foreign keys.
const removeOrphans = `
DELETE FROM line_items WHERE transactionId NOT IN (SELECT id FROM transactions);
DELETE FROM transaction_tags
  WHERE transactionId NOT IN (SELECT id FROM transactions) OR tagId NOT IN (SELECT id FROM tags);`;

// Rules that span several rows, so CHECKs and triggers cannot test them. Each query must
// find no rows after a fill.
const shape = `SELECT t.id, t.kind, t.direction,
    SUM(l.accountId IS NOT NULL) AS accountLegs, SUM(l.personId IS NOT NULL) AS personLegs,
    SUM(CASE WHEN l.accountId IS NOT NULL THEN l.amountMinor END) AS accountSum,
    SUM(CASE WHEN l.personId IS NOT NULL THEN l.amountMinor END) AS personSum,
    COUNT(DISTINCT l.accountId) AS accounts, COUNT(DISTINCT l.currencyCode) AS currencies,
    MIN(l.amountMinor) AS low, MAX(l.amountMinor) AS high
  FROM transactions t LEFT JOIN legs l ON l.transactionId = t.id GROUP BY t.id`;
const ledgerChecks = {
  'a Transaction without legs': `SELECT t.id FROM transactions t
    WHERE NOT EXISTS (SELECT 1 FROM legs WHERE transactionId = t.id)`,
  'an Expense with the wrong legs': `SELECT id FROM (${shape}) WHERE kind = 'EXPENSE'
    AND NOT (accountLegs = 1 AND personLegs = 0 AND high < 0)`,
  'an Income or reimbursement with the wrong legs': `SELECT id FROM (${shape})
    WHERE kind IN ('INCOME', 'REIMBURSEMENT') AND NOT (accountLegs = 1 AND personLegs = 0 AND low > 0)`,
  'a Transfer with the wrong legs': `SELECT id FROM (${shape}) WHERE kind = 'TRANSFER'
    AND NOT (accountLegs = 2 AND personLegs = 0 AND accounts = 2 AND low < 0 AND high > 0
      AND (currencies = 2 OR accountSum = 0))`,
  'a lending Transaction with the wrong legs': `SELECT id FROM (${shape}) WHERE kind = 'LENDING'
    AND NOT (accountLegs = 1 AND personLegs = 1 AND currencies = 1 AND accountSum = -personSum)`,
  'a Write-off with the wrong legs': `SELECT id FROM (${shape}) WHERE kind = 'WRITE_OFF'
    AND NOT (accountLegs = 0 AND personLegs = 1 AND (personSum < 0) = (direction = 'LENT'))`,
  'a reimbursement kind without its row': `SELECT t.id FROM transactions t
    LEFT JOIN reimbursements r ON r.transactionId = t.id
    WHERE (t.kind = 'REIMBURSEMENT') <> (r.transactionId IS NOT NULL)`,
  'a reimbursement in another Currency': `SELECT r.transactionId FROM reimbursements r
    JOIN legs pl ON pl.transactionId = r.transactionId AND pl.accountId IS NOT NULL
    JOIN legs xl ON xl.transactionId = r.expenseId AND xl.accountId IS NOT NULL
    WHERE pl.currencyCode <> xl.currencyCode`,
  'a split share on a Transaction that is not an Expense': `SELECT s.expenseId FROM split_shares s
    JOIN transactions t ON t.id = s.expenseId WHERE t.kind <> 'EXPENSE'`,
};

/** Throws if the data breaks a rule of the legs model or a foreign key. */
async function checkLedger(db: Connection) {
  const violations = await db.getAllAsync<Record<string, unknown>>('PRAGMA foreign_key_check');
  if (violations.length)
    throw new Error(`Foreign key violations: ${JSON.stringify(violations.slice(0, 5))}`);
  for (const [problem, query] of Object.entries(ledgerChecks)) {
    const rows = await db.getAllAsync<{ id: number }>(`${query} LIMIT 5`);
    if (rows.length)
      throw new Error(`The data has ${problem}: ${rows.map((row) => Object.values(row)[0])}`);
  }
}

async function dropLegacyTables(db: Connection) {
  await db.execAsync(legacyNames.map((table) => `DROP TABLE temp.legacy_${table};`).join('\n'));
}

/** Runs the old schema setup, so that every old table and column exists. */
async function setUpLegacySchema(db: Connection) {
  await db.execAsync(legacySchema);
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(transactions)');
  if (!columns.some((column) => column.name === 'receivedAmountMinor'))
    await db.execAsync(
      'ALTER TABLE transactions ADD COLUMN receivedAmountMinor INTEGER CHECK(receivedAmountMinor > 0)',
    );
}

/** A v1 backup of a database with the old schema. */
export async function legacySnapshot(db: Connection): Promise<BackupData> {
  const all = <T = Record<string, unknown>>(query: string) => db.getAllAsync<T>(query);
  const bool = (rows: Record<string, unknown>[], fields: string[]) =>
    rows.map((row) => {
      const result: Record<string, unknown> = { ...row };
      for (const field of fields) result[field] = Boolean(result[field]);
      return result;
    });
  const { favorite, settings, ...tables } = await readAll({
    favorite: db.getFirstAsync<{ id: number }>(
      'SELECT id FROM accounts WHERE isFavorite = 1 LIMIT 1',
    ),
    settings: db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'backupSettings'",
    ),
    accounts: all(
      'SELECT id, name, currencyCode, openingBalanceMinor, isFavorite FROM accounts ORDER BY id',
    ),
    categories: all(
      'SELECT id, name, type, parentId, iconKey, needsReview FROM categories ORDER BY id',
    ),
    transactions: all(`SELECT id, type, amountMinor, receivedAmountMinor,
      date AS dateEpochDay, accountId, transferAccountId, categoryId, note, excludeFromReport, source
      FROM transactions ORDER BY id`),
    lineItems: all(
      'SELECT id, transactionId, name, amountMinor, quantity FROM line_items ORDER BY id',
    ),
    tags: all('SELECT id, name FROM tags ORDER BY id'),
    transactionTags: all(
      'SELECT transactionId, tagId FROM transaction_tags ORDER BY transactionId, tagId',
    ),
    transferCandidates: all(
      'SELECT id, outgoingTxnId, incomingTxnId, confidenceNote, resolved FROM transfer_candidates ORDER BY id',
    ),
    moneyLoverImportRows: all(
      'SELECT rowKey, transactionId FROM moneylover_import_rows ORDER BY rowKey',
    ),
    creditCards: all(
      'SELECT accountId, parentAccountId, statementDay, dueDay FROM credit_cards ORDER BY accountId',
    ),
    people: all('SELECT id, name FROM people ORDER BY id'),
    splitShares: all(
      'SELECT expenseId, personId, amountMinor FROM split_shares ORDER BY expenseId, personId',
    ),
    reimbursements: all(
      'SELECT transactionId, expenseId, personId FROM reimbursements ORDER BY transactionId',
    ),
    lendingEntries: all(`SELECT e.id, e.personId, e.kind, e.transactionId,
      CASE WHEN t.id IS NULL THEN e.currencyCode ELSE a.currencyCode END AS currencyCode,
      COALESCE(t.amountMinor, e.amountMinor) AS amountMinor, COALESCE(t.date, e.date) AS dateEpochDay,
      CASE WHEN t.id IS NULL THEN e.note ELSE t.note END AS note
      FROM lending_entries e LEFT JOIN transactions t ON t.id = e.transactionId
      LEFT JOIN accounts a ON a.id = t.accountId ORDER BY e.id`),
  });
  return {
    schemaVersion: 1,
    ...tables,
    accounts: bool(tables.accounts, ['isFavorite']),
    categories: bool(tables.categories, ['needsReview']),
    transactions: tables.transactions.map(({ receivedAmountMinor, ...row }) => ({
      ...row,
      ...(receivedAmountMinor == null ? {} : { receivedAmountMinor }),
      excludeFromReport: Boolean(row.excludeFromReport),
    })),
    transferCandidates: bool(tables.transferCandidates, ['resolved']),
    settings: settings
      ? JSON.parse(settings.value)
      : { favoriteAccountId: favorite?.id ?? null, displayRate: null },
  } as BackupData;
}

async function userVersion(db: Connection) {
  return (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version;
}

/**
 * Moves a database with the old schema to the legs schema. It follows SQLite's steps for
 * a schema change: foreign keys off before the transaction, one exclusive transaction,
 * copy, drop, create, fill, then a check before the commit. Run it on the main connection
 * before anything else uses the connection. Returns false if the database already has the
 * legs schema. On an error it rolls back and throws, and the next start tries again.
 */
export async function migrateToLegs(db: MainConnection): Promise<boolean> {
  if ((await userVersion(db)) >= LEGS_SCHEMA_VERSION) return false;
  if (db.isInTransactionSync()) throw new Error('Run the migration outside a transaction.');
  // SQLite ignores this PRAGMA inside a transaction, so it comes before BEGIN.
  await db.execAsync('PRAGMA foreign_keys = OFF');
  try {
    const foreignKeys = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    if (foreignKeys?.foreign_keys !== 0) throw new Error('Could not turn foreign keys off.');
    await db.execAsync('BEGIN EXCLUSIVE');
    // The old tables go only to TEMP tables, so the database file keeps no second copy.
    for (const table of legacyNames)
      await db.execAsync(`CREATE TEMP TABLE legacy_${table} AS SELECT * FROM main.${table}`);
    await db.execAsync(`DROP VIEW IF EXISTS report_transactions;
      DROP VIEW IF EXISTS split_share_progress;
      DROP TRIGGER IF EXISTS remove_reimbursement_metadata;
      DROP TRIGGER IF EXISTS keep_reimbursed_expense;
      DROP TRIGGER IF EXISTS preserve_reimbursement_expense;
      ${replacedTables.map((table) => `DROP TABLE main.${table};`).join('\n')}`);
    await db.execAsync(legsSchema);
    await db.execAsync(fillFromLegacy);
    await db.execAsync(removeOrphans);
    await dropLegacyTables(db);
    await checkLedger(db);
    await db.execAsync(`PRAGMA user_version = ${LEGS_SCHEMA_VERSION}`);
    await db.execAsync('COMMIT');
    return true;
  } catch (error) {
    if (db.isInTransactionSync()) await db.execAsync('ROLLBACK');
    throw error;
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON');
  }
}

/**
 * Prepares the main connection. A new install gets the legs schema. A database with the
 * old schema gets a v1 backup from `saveBackup`, then the migration. If `saveBackup`
 * throws, the database stays as it is.
 */
export async function openLedger(db: MainConnection, saveBackup: (json: string) => Promise<void>) {
  await db.execAsync('PRAGMA foreign_keys = ON');
  if ((await userVersion(db)) < LEGS_SCHEMA_VERSION) {
    const old = await db.getFirstAsync(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transactions'",
    );
    if (old) {
      await setUpLegacySchema(db);
      await saveBackup(encodeBackup(await legacySnapshot(db)));
      await migrateToLegs(db);
    } else {
      await db.execAsync('BEGIN EXCLUSIVE');
      try {
        await db.execAsync(legsSchema);
        await db.execAsync(`PRAGMA user_version = ${LEGS_SCHEMA_VERSION}`);
        await db.execAsync('COMMIT');
      } catch (error) {
        if (db.isInTransactionSync()) await db.execAsync('ROLLBACK');
        throw error;
      }
    }
  }
  // Run the schema on every start, so that a changed trigger or view reaches this database.
  await db.execAsync(legsSchema);
}

type SQLiteValue = string | number | null;
const value = (item: unknown): SQLiteValue =>
  typeof item === 'boolean' ? Number(item) : ((item ?? null) as SQLiteValue);

/**
 * Replaces all data with the rows of a v1 backup. Call it inside a transaction. Device-local
 * settings stay. The v1 rows go into legacy_* TEMP tables, and the fill SQL of the migration
 * makes the legs.
 */
export async function restoreLegacyRows(
  tx: Connection & Pick<SQLiteDatabase, 'runAsync'>,
  data: BackupData,
) {
  // Parent Categories can come after their children. With foreign keys on, SQLite checks
  // them at the commit. With foreign keys off, checkLedger() checks them.
  await tx.execAsync('PRAGMA defer_foreign_keys = ON');
  // This order passes the guards of the triggers. Deleting a Transaction deletes its legs,
  // split shares, Line Items and tags.
  await tx.execAsync(`DELETE FROM reimbursements; DELETE FROM transactions;
    DELETE FROM credit_cards; DELETE FROM accounts; DELETE FROM people; DELETE FROM tags;
    DELETE FROM categories;`);
  for (const table of legacyNames)
    await tx.execAsync(
      `CREATE TEMP TABLE legacy_${table} (${Object.entries(legacyTables[table])
        .map(([column, type]) => `${column} ${type}`)
        .join(', ')})`,
    );
  const insert = async (table: string, columns: readonly string[], rows: unknown[][]) => {
    const statement = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    for (const row of rows) await tx.runAsync(statement, row.map(value));
  };
  const legacy = (table: LegacyTable, rows: Record<string, unknown>[]) => {
    const columns = Object.keys(legacyTables[table]);
    return insert(
      `temp.legacy_${table}`,
      columns,
      rows.map((row) => columns.map((column) => row[column])),
    );
  };
  await legacy('accounts', data.accounts);
  await legacy('categories', data.categories);
  const withDate = <R extends { dateEpochDay: number }>({ dateEpochDay, ...row }: R) => ({
    ...row,
    date: dateEpochDay,
  });
  await legacy('transactions', data.transactions.map(withDate));
  await legacy('tags', data.tags);
  await legacy('lending_entries', (data.lendingEntries ?? []).map(withDate));
  await legacy('reimbursements', data.reimbursements ?? []);
  await legacy('app_settings', [{ key: 'backupSettings', value: JSON.stringify(data.settings) }]);
  // Person legs need their people, so people come before the fill.
  await insert(
    'people',
    ['id', 'name'],
    (data.people ?? []).map((person) => [person.id, person.name]),
  );
  await tx.execAsync(fillFromLegacy);
  await insert(
    'credit_cards',
    ['accountId', 'parentAccountId', 'statementDay', 'dueDay'],
    (data.creditCards ?? []).map((card) => [
      card.accountId,
      card.parentAccountId,
      card.statementDay,
      card.dueDay,
    ]),
  );
  await insert(
    'line_items',
    ['id', 'transactionId', 'name', 'amountMinor', 'quantity'],
    data.lineItems.map((item) => [
      item.id,
      item.transactionId,
      item.name,
      item.amountMinor,
      item.quantity,
    ]),
  );
  await insert(
    'transaction_tags',
    ['transactionId', 'tagId'],
    data.transactionTags.map((link) => [link.transactionId, link.tagId]),
  );
  await insert(
    'split_shares',
    ['expenseId', 'personId', 'amountMinor'],
    (data.splitShares ?? []).map((share) => [share.expenseId, share.personId, share.amountMinor]),
  );
  await insert(
    'reimbursements',
    ['transactionId', 'expenseId', 'personId'],
    (data.reimbursements ?? []).map((row) => [row.transactionId, row.expenseId, row.personId]),
  );
  await tx.execAsync(removeOrphans);
  await dropLegacyTables(tx);
  await checkLedger(tx);
}
