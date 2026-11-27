// The restore of a v1 backup into the legs schema (ADR 0013, ADR 0014). The v1 rows go into
// TEMP tables named legacy_*, with the columns of the old schema. SQL there cleans them,
// and then it fills the legs schema from them.
import { assertCleanBackup, type BackupV1 } from './backup-v1.ts';
import {
  checkLedger,
  clearLedger,
  deferForeignKeys,
  insertRows,
  type Connection,
  type Writer,
} from './backup-restore.ts';
import { readAll } from './read-all.ts';

/**
 * The tables of the old schema, with the columns and types that a v1 backup, the cleaning
 * and the fill use. The types give the TEMP tables the affinity of the old tables, so a
 * number from JavaScript is stored as an INTEGER.
 */
const legacyTables = {
  accounts: {
    id: 'INTEGER',
    name: 'TEXT',
    currencyCode: 'TEXT',
    openingBalanceMinor: 'INTEGER',
    isFavorite: 'INTEGER',
  },
  categories: {
    id: 'INTEGER',
    name: 'TEXT',
    type: 'TEXT',
    parentId: 'INTEGER',
    iconKey: 'TEXT',
    needsReview: 'INTEGER',
  },
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
    source: 'TEXT',
  },
  line_items: {
    id: 'INTEGER',
    transactionId: 'INTEGER',
    name: 'TEXT',
    amountMinor: 'INTEGER',
    quantity: 'REAL',
  },
  tags: { id: 'INTEGER', name: 'TEXT' },
  transaction_tags: { transactionId: 'INTEGER', tagId: 'INTEGER' },
  transfer_candidates: {
    id: 'INTEGER',
    outgoingTxnId: 'INTEGER',
    incomingTxnId: 'INTEGER',
    confidenceNote: 'TEXT',
    resolved: 'INTEGER',
  },
  moneylover_import_rows: { rowKey: 'TEXT', transactionId: 'INTEGER' },
  people: { id: 'INTEGER', name: 'TEXT' },
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
  credit_cards: {
    accountId: 'INTEGER',
    parentAccountId: 'INTEGER',
    statementDay: 'INTEGER',
    dueDay: 'INTEGER',
  },
  split_shares: { expenseId: 'INTEGER', personId: 'INTEGER', amountMinor: 'INTEGER' },
  reimbursements: { transactionId: 'INTEGER', expenseId: 'INTEGER', personId: 'INTEGER' },
  app_settings: { key: 'TEXT', value: 'TEXT' },
};
type LegacyTable = keyof typeof legacyTables;
const legacyNames = Object.keys(legacyTables) as LegacyTable[];
const columnsOf = (table: LegacyTable) => Object.keys(legacyTables[table]);

/** Makes an empty TEMP copy of each old table, named legacy_*. */
async function createLegacyTables(db: Connection) {
  await dropLegacyTables(db);
  await db.execAsync(
    legacyNames
      .map(
        (table) =>
          `CREATE TEMP TABLE legacy_${table} (${Object.entries(legacyTables[table])
            .map(([column, type]) => `${column} ${type}`)
            .join(', ')});`,
      )
      .join('\n'),
  );
}

async function dropLegacyTables(db: Connection) {
  await db.execAsync(
    legacyNames.map((table) => `DROP TABLE IF EXISTS temp.legacy_${table};`).join('\n'),
  );
}

/**
 * Cleans the TEMP copies of the old tables. The old app wrote on Expo's connection for
 * exclusive writes, where foreign keys are off, so the foreign key actions of the old
 * schema did not always run. This SQL does what they would have done. It decides with the
 * old ids only, before a Write-off gets a new id, so no row can move to another Transaction.
 *
 * - ON DELETE SET NULL: a missing parent Category, or a missing Category of a Transaction.
 * - ON DELETE CASCADE: Line Items, tag links, import rows, lending entries, split shares and
 *   reimbursements of a missing Transaction, a missing tag or a missing split share, and the
 *   card settings of a missing Account.
 * - The card parent had no action. A missing parent becomes no parent. The parent is only
 *   the default source for a settlement, so no Leg needs it.
 * - Only a Transfer has a destination Account. The fill does not read transferAccountId or
 *   receivedAmountMinor of other rows, so this SQL clears them.
 *
 * The old schema compared tag names by case, and the legs schema does not. Tags whose names
 * differ only by case become the tag with the lowest id, with all of their links.
 *
 * Transfer candidates have no foreign key and the backup does not check them. A missing
 * Account or person that a Leg or a split share needs cannot be repaired. Then
 * assertNeededRows() stops the work and names the row.
 */
const cleanLegacy = `
UPDATE legacy_categories SET parentId = NULL
  WHERE parentId NOT IN (SELECT id FROM legacy_categories);
UPDATE legacy_transactions SET categoryId = NULL
  WHERE categoryId NOT IN (SELECT id FROM legacy_categories);
DELETE FROM legacy_line_items WHERE transactionId NOT IN (SELECT id FROM legacy_transactions);
DELETE FROM legacy_transaction_tags
  WHERE transactionId NOT IN (SELECT id FROM legacy_transactions)
    OR tagId NOT IN (SELECT id FROM legacy_tags);
DELETE FROM legacy_moneylover_import_rows
  WHERE transactionId NOT IN (SELECT id FROM legacy_transactions);
DELETE FROM legacy_lending_entries
  WHERE transactionId IS NOT NULL AND transactionId NOT IN (SELECT id FROM legacy_transactions);
DELETE FROM legacy_split_shares WHERE expenseId NOT IN (SELECT id FROM legacy_transactions);
DELETE FROM legacy_reimbursements
  WHERE transactionId NOT IN (SELECT id FROM legacy_transactions)
    OR expenseId NOT IN (SELECT id FROM legacy_transactions)
    OR (personId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM legacy_split_shares s
      WHERE s.expenseId = legacy_reimbursements.expenseId
        AND s.personId = legacy_reimbursements.personId));
DELETE FROM legacy_credit_cards WHERE accountId NOT IN (SELECT id FROM legacy_accounts);
UPDATE legacy_credit_cards SET parentAccountId = NULL
  WHERE parentAccountId NOT IN (SELECT id FROM legacy_accounts);
UPDATE legacy_transactions SET transferAccountId = NULL, receivedAmountMinor = NULL
  WHERE type <> 'TRANSFER';

UPDATE legacy_transaction_tags SET tagId = (
  SELECT MIN(same.id) FROM legacy_tags tag
  JOIN legacy_tags same ON same.name = tag.name COLLATE NOCASE
  WHERE tag.id = legacy_transaction_tags.tagId);
DELETE FROM legacy_tags WHERE id > (
  SELECT MIN(same.id) FROM legacy_tags same WHERE same.name = legacy_tags.name COLLATE NOCASE);
`;

/**
 * The rows that a Leg or a split share needs. Each query gives the table, the row and the
 * missing id. A split share has no id of its own, so its row is the id of its Expense. The app has no delete for Accounts and people, so such a row is damaged data.
 */
const neededRows = [
  `SELECT 'transactions' AS tableName, id AS row, 'Account' AS needs, accountId AS missing
    FROM legacy_transactions WHERE accountId IS NULL
      OR accountId NOT IN (SELECT id FROM legacy_accounts)`,
  `SELECT 'transactions' AS tableName, id AS row, 'destination Account' AS needs,
    transferAccountId AS missing FROM legacy_transactions
    WHERE type = 'TRANSFER' AND (transferAccountId IS NULL
      OR transferAccountId NOT IN (SELECT id FROM legacy_accounts))`,
  `SELECT 'lending_entries' AS tableName, id AS row, 'person' AS needs, personId AS missing
    FROM legacy_lending_entries
    WHERE personId IS NULL OR personId NOT IN (SELECT id FROM legacy_people)`,
  `SELECT 'split_shares' AS tableName, expenseId AS row, 'person' AS needs,
    personId AS missing FROM legacy_split_shares
    WHERE personId IS NULL OR personId NOT IN (SELECT id FROM legacy_people)`,
];

/** Throws if an old row points to a missing Account or person that a Leg or a share needs. */
async function assertNeededRows(db: Connection) {
  type Missing = { tableName: string; row: number; needs: string; missing: number | null };
  for (const query of neededRows) {
    const found = await db.getFirstAsync<Missing>(`${query} LIMIT 1`);
    if (found)
      throw new Error(
        `Row ${found.row} of ${found.tableName} needs ${found.needs} ${found.missing ?? '(none)'}, ` +
          'which does not exist. The app cannot repair this row.',
      );
  }
}

/** Cleans the TEMP copies, then checks the rows that the cleaning cannot repair. */
async function cleanLegacyTables(db: Connection) {
  await db.execAsync(cleanLegacy);
  await assertNeededRows(db);
}

/**
 * Fills the legs schema from the cleaned legacy_* TEMP tables. The mapping is the spec in
 * the ADR: each old Transaction keeps its id, lending entries become legs, and each
 * Write-off becomes a Transaction. Device-local rows of app_settings stay.
 */
const fillFromLegacy = `
INSERT INTO accounts (id, name, currencyCode, openingBalanceMinor)
  SELECT id, name, currencyCode, openingBalanceMinor FROM legacy_accounts;
INSERT INTO credit_cards (accountId, parentAccountId, statementDay, dueDay)
  SELECT accountId, parentAccountId, statementDay, dueDay FROM legacy_credit_cards;

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
INSERT INTO people (id, name) SELECT id, name FROM legacy_people;

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

-- Write-offs get the next Transaction ids after the highest old id, in lending entry order.
CREATE TEMP TABLE new_write_offs AS
  SELECT e.*, (SELECT COALESCE(MAX(id), 0) FROM legacy_transactions)
    + ROW_NUMBER() OVER (ORDER BY e.id) AS newId
  FROM legacy_lending_entries e WHERE e.transactionId IS NULL;
INSERT INTO transactions (id, kind, direction, date, note)
  SELECT newId, 'WRITE_OFF', CASE WHEN kind = 'WRITE_OFF_LENT' THEN 'LENT' ELSE 'BORROWED' END,
    date, note
  FROM new_write_offs;

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

-- A Write-off has only a Person leg.
INSERT INTO legs (transactionId, personId, currencyCode, amountMinor)
  SELECT newId, personId, currencyCode,
    CASE WHEN kind = 'WRITE_OFF_LENT' THEN -amountMinor ELSE amountMinor END
  FROM new_write_offs ORDER BY newId;

INSERT INTO line_items (id, transactionId, name, amountMinor, quantity)
  SELECT id, transactionId, name, amountMinor, quantity FROM legacy_line_items;
INSERT INTO transaction_tags (transactionId, tagId)
  SELECT DISTINCT transactionId, tagId FROM legacy_transaction_tags;
-- A reimbursement needs its split share and its kind, so it comes after both.
INSERT INTO split_shares (expenseId, personId, amountMinor)
  SELECT expenseId, personId, amountMinor FROM legacy_split_shares;
INSERT INTO reimbursements (transactionId, expenseId, personId)
  SELECT transactionId, expenseId, personId FROM legacy_reimbursements;

-- One row for each portable setting. Device-local rows stay as they are.
-- The favorite comes from the account flag, or else from the settings of the file.
DELETE FROM app_settings WHERE key IN ('favoriteAccountId', 'displayRate');
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

DROP TABLE temp.new_write_offs;
`;

/** A v1 backup of the cleaned legacy_* TEMP tables. */
async function snapshotLegacyTables(db: Connection): Promise<BackupV1> {
  const all = <T = Record<string, unknown>>(query: string) => db.getAllAsync<T>(query);
  const bool = (rows: Record<string, unknown>[], fields: string[]) =>
    rows.map((row) => {
      const result: Record<string, unknown> = { ...row };
      for (const field of fields) result[field] = Boolean(result[field]);
      return result;
    });
  const { favorite, settings, ...tables } = await readAll({
    favorite: db.getFirstAsync<{ id: number }>(
      'SELECT id FROM legacy_accounts WHERE isFavorite = 1 ORDER BY id LIMIT 1',
    ),
    settings: db.getFirstAsync<{ value: string }>(
      "SELECT value FROM legacy_app_settings WHERE key = 'backupSettings'",
    ),
    accounts: all(
      'SELECT id, name, currencyCode, openingBalanceMinor, isFavorite FROM legacy_accounts ORDER BY id',
    ),
    categories: all(
      'SELECT id, name, type, parentId, iconKey, needsReview FROM legacy_categories ORDER BY id',
    ),
    transactions: all(`SELECT id, type, amountMinor, receivedAmountMinor,
      date AS dateEpochDay, accountId, transferAccountId, categoryId, note, excludeFromReport, source
      FROM legacy_transactions ORDER BY id`),
    lineItems: all(
      'SELECT id, transactionId, name, amountMinor, quantity FROM legacy_line_items ORDER BY id',
    ),
    tags: all('SELECT id, name FROM legacy_tags ORDER BY id'),
    transactionTags: all(
      'SELECT DISTINCT transactionId, tagId FROM legacy_transaction_tags ORDER BY transactionId, tagId',
    ),
    transferCandidates: all(
      'SELECT id, outgoingTxnId, incomingTxnId, confidenceNote, resolved FROM legacy_transfer_candidates ORDER BY id',
    ),
    moneyLoverImportRows: all(
      'SELECT rowKey, transactionId FROM legacy_moneylover_import_rows ORDER BY rowKey',
    ),
    creditCards: all(
      'SELECT accountId, parentAccountId, statementDay, dueDay FROM legacy_credit_cards ORDER BY accountId',
    ),
    people: all('SELECT id, name FROM legacy_people ORDER BY id'),
    splitShares: all(
      'SELECT expenseId, personId, amountMinor FROM legacy_split_shares ORDER BY expenseId, personId',
    ),
    reimbursements: all(
      'SELECT transactionId, expenseId, personId FROM legacy_reimbursements ORDER BY transactionId',
    ),
    lendingEntries: all(`SELECT e.id, e.personId, e.kind, e.transactionId,
      CASE WHEN t.id IS NULL THEN e.currencyCode ELSE a.currencyCode END AS currencyCode,
      COALESCE(t.amountMinor, e.amountMinor) AS amountMinor, COALESCE(t.date, e.date) AS dateEpochDay,
      CASE WHEN t.id IS NULL THEN e.note ELSE t.note END AS note
      FROM legacy_lending_entries e LEFT JOIN legacy_transactions t ON t.id = e.transactionId
      LEFT JOIN legacy_accounts a ON a.id = t.accountId ORDER BY e.id`),
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
  } as BackupV1;
}

/**
 * Replaces all data with the rows of a v1 backup. Call it inside a transaction. Device-local
 * settings stay. The v1 rows go into legacy_* TEMP tables, where the cleaning and the checks
 * run before any live row changes. Then the fill SQL makes the legs.
 */
export async function restoreLegacyRows(tx: Writer, data: BackupV1) {
  await deferForeignKeys(tx);
  await createLegacyTables(tx);
  const legacy = (table: LegacyTable, rows: readonly object[]) =>
    insertRows(tx, `temp.legacy_${table}`, columnsOf(table), rows);
  const withDate = <R extends { dateEpochDay: number }>({ dateEpochDay, ...row }: R) => ({
    ...row,
    date: dateEpochDay,
  });
  await legacy('accounts', data.accounts);
  await legacy('categories', data.categories);
  await legacy('transactions', data.transactions.map(withDate));
  await legacy('line_items', data.lineItems);
  await legacy('tags', data.tags);
  await legacy('transaction_tags', data.transactionTags);
  await legacy('people', data.people ?? []);
  await legacy('lending_entries', (data.lendingEntries ?? []).map(withDate));
  await legacy('credit_cards', data.creditCards ?? []);
  await legacy('split_shares', data.splitShares ?? []);
  await legacy('reimbursements', data.reimbursements ?? []);
  await legacy('app_settings', [{ key: 'backupSettings', value: JSON.stringify(data.settings) }]);
  await cleanLegacyTables(tx);
  // The cleaned rows must be a valid backup, as a backup that the app writes is.
  assertCleanBackup(await snapshotLegacyTables(tx));
  await tx.execAsync(clearLedger);
  await tx.execAsync(fillFromLegacy);
  await dropLegacyTables(tx);
  await checkLedger(tx);
}
