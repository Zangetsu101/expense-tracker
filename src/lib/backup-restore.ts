// The restore of a backup into the legs schema (ADR 0014). A v2 file has the rows of the
// legs schema, so its restore inserts them directly. backup-v1-restore.ts restores a v1 file.
import type { SQLiteDatabase } from 'expo-sqlite';
import { backupV2Tables, type BackupV2 } from './backup-v2.ts';

export type Connection = Pick<SQLiteDatabase, 'execAsync' | 'getAllAsync' | 'getFirstAsync'>;

// Rules that span several rows, so CHECKs and triggers cannot test them. Each query must
// find no rows after a restore.
const shape = `SELECT t.id, t.kind, t.direction,
    SUM(l.accountId IS NOT NULL) AS accountLegs, SUM(l.personId IS NOT NULL) AS personLegs,
    SUM(CASE WHEN l.accountId IS NOT NULL THEN l.amountMinor END) AS accountSum,
    SUM(CASE WHEN l.personId IS NOT NULL THEN l.amountMinor END) AS personSum,
    COUNT(DISTINCT l.accountId) AS accounts, COUNT(DISTINCT l.currencyCode) AS currencies,
    MIN(l.amountMinor) AS low, MAX(l.amountMinor) AS high
  FROM transactions t LEFT JOIN legs l ON l.transactionId = t.id GROUP BY t.id`;
const ledgerChecks = {
  // Read the id as text: a number above this limit has no exact JavaScript value.
  'a Transaction id that is too large': `SELECT CAST(id AS TEXT) AS id FROM transactions
    WHERE id > ${Number.MAX_SAFE_INTEGER}`,
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
export async function checkLedger(db: Connection) {
  const violations = await db.getAllAsync<Record<string, unknown>>('PRAGMA foreign_key_check');
  if (violations.length)
    throw new Error(`Foreign key violations: ${JSON.stringify(violations.slice(0, 5))}`);
  for (const [problem, query] of Object.entries(ledgerChecks)) {
    const rows = await db.getAllAsync<{ id: number }>(`${query} LIMIT 5`);
    if (rows.length)
      throw new Error(`The data has ${problem}: ${rows.map((row) => Object.values(row)[0])}`);
  }
}

/**
 * Deletes all data except device-local settings. This order passes the guards of the
 * triggers. Deleting a Transaction deletes its Legs, split shares, Line Items and tags.
 */
export const clearLedger = `DELETE FROM reimbursements; DELETE FROM transactions;
  DELETE FROM credit_cards; DELETE FROM accounts; DELETE FROM people; DELETE FROM tags;
  DELETE FROM categories;`;

type SQLiteValue = string | number | null;
const value = (item: unknown): SQLiteValue =>
  typeof item === 'boolean' ? Number(item) : ((item ?? null) as SQLiteValue);

export type Writer = Connection & Pick<SQLiteDatabase, 'runAsync'>;

/** Inserts the rows into the table. A boolean becomes 0 or 1, and a missing field null. */
export async function insertRows(
  tx: Writer,
  table: string,
  columns: string[],
  rows: readonly object[],
) {
  const statement = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
  for (const row of rows)
    await tx.runAsync(
      statement,
      columns.map((column) => value((row as Record<string, unknown>)[column])),
    );
}

/**
 * A restore can insert a parent Category after its children. With foreign keys on, SQLite
 * checks them at the commit. With foreign keys off, checkLedger() checks them.
 */
export const deferForeignKeys = (tx: Writer) => tx.execAsync('PRAGMA defer_foreign_keys = ON');

/**
 * Replaces all data with the rows of a v2 backup (ADR 0014). Call it inside a transaction,
 * and roll back if it throws. Device-local settings stay. The rows go directly into the
 * tables. The CHECK constraints and the triggers check each row, and checkLedger() checks
 * the rules that span rows. So a file with a missing parent row or a wrong set of Legs
 * changes nothing.
 */
export async function restoreLegsRows(tx: Writer, data: BackupV2) {
  await deferForeignKeys(tx);
  await tx.execAsync(clearLedger);
  for (const [name, { table, fields }] of Object.entries(backupV2Tables))
    await insertRows(tx, table, Object.keys(fields), data[name as keyof typeof backupV2Tables]);
  const { favoriteAccountId, displayRate } = data.settings;
  await tx.execAsync("DELETE FROM app_settings WHERE key IN ('favoriteAccountId', 'displayRate')");
  if (favoriteAccountId !== null) {
    const favorite = await tx.runAsync(
      "INSERT INTO app_settings (key, value) SELECT 'favoriteAccountId', json(id) FROM accounts WHERE id = ?",
      [favoriteAccountId],
    );
    if (favorite.changes !== 1)
      throw new Error(`The favorite Account ${favoriteAccountId} does not exist.`);
  }
  if (displayRate)
    await tx.runAsync("INSERT INTO app_settings (key, value) VALUES ('displayRate', ?)", [
      JSON.stringify(displayRate),
    ]);
  await checkLedger(tx);
}
