import { defaultCurrencyCode } from './currency.ts';
import { notifyDataChanged } from './data-changes.ts';
import { openLedger } from './legs-migration.ts';
import * as SQLite from 'expo-sqlite';

export type Account = { id: number; name: string; currencyCode: string; isFavorite: number };

/** SQL for the id of the favorite Account, or null. */
export const favoriteAccountIdSql =
  "(SELECT CAST(value AS INTEGER) FROM app_settings WHERE key = 'favoriteAccountId')";
/** SQL that is 1 for the favorite Account and 0 for the others. */
export const isFavoriteSql = (account: string) => `(${account}.id IS ${favoriteAccountIdSql})`;

/** Writes the v1 backup before the migration. The module loads only when a migration runs. */
async function saveBackupBeforeMigration(json: string) {
  const { writePreMigrationBackup } = await import('./pre-migration-backup.ts');
  await writePreMigrationBackup(json);
}

let connection: Promise<SQLite.SQLiteDatabase> | undefined;
/**
 * Opens the database. The promise resolves only after the schema is ready. A database
 * with the old schema is migrated first, so no other read can run inside the migration.
 */
export function database() {
  connection ??= SQLite.openDatabaseAsync('expense-poc.db')
    .then(async (db) => {
      await openLedger(db, saveBackupBeforeMigration);
      const cash = await db.runAsync(
        "INSERT INTO accounts (name, currencyCode) SELECT 'Cash', ? WHERE NOT EXISTS (SELECT 1 FROM accounts)",
        [defaultCurrencyCode],
      );
      // The new Cash Account is the only Account, and it is the favorite.
      if (cash.changes === 1)
        await db.runAsync(
          "INSERT OR REPLACE INTO app_settings (key, value) SELECT 'favoriteAccountId', json(MAX(id)) FROM accounts",
        );
      await db.runAsync(
        "INSERT INTO categories (name, type) SELECT 'Other', 'EXPENSE' WHERE NOT EXISTS (SELECT 1 FROM categories WHERE type = 'EXPENSE')",
      );
      return db;
    })
    .catch((error) => {
      connection = undefined;
      throw error;
    });
  return connection;
}

export async function listAccounts() {
  return (await database()).getAllAsync<Account>(
    `SELECT a.id, a.name, a.currencyCode, ${isFavoriteSql('a')} AS isFavorite FROM accounts a
    ORDER BY isFavorite DESC, a.name, a.id`,
  );
}
export async function setFavoriteAccount(accountId: number) {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const account = await tx.getFirstAsync<{ id: number }>('SELECT id FROM accounts WHERE id = ?', [
      accountId,
    ]);
    if (!account) throw new Error('Account not found.');
    await tx.runAsync(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('favoriteAccountId', json(?))",
      [accountId],
    );
  });
  notifyDataChanged();
}
export function epochDay(date: Date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}
export function dateFromEpochDay(day: number) {
  const utc = new Date(day * 86400000);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12);
}
