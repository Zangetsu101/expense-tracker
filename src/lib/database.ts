import { defaultCurrencyCode } from './currency.ts';
import { notifyDataChanged } from './data-changes.ts';
import * as SQLite from 'expo-sqlite';

export type Account = { id: number; name: string; currencyCode: string; isFavorite: number };
export type Category = { id: number; name: string; type: 'EXPENSE' | 'INCOME' };
export type TransactionRow = {
  id: number;
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amountMinor: number;
  date: number;
  accountName: string;
  categoryName: string | null;
  note: string | null;
};

let connection: Promise<SQLite.SQLiteDatabase> | undefined;
export function database() {
  connection ??= SQLite.openDatabaseAsync('expense-poc.db')
    .then(async (db) => {
      await db.execAsync(`PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, currencyCode TEXT NOT NULL, openingBalanceMinor INTEGER NOT NULL DEFAULT 0, isFavorite INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, parentId INTEGER REFERENCES categories(id) ON DELETE SET NULL, iconKey TEXT, needsReview INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, type TEXT NOT NULL, amountMinor INTEGER NOT NULL CHECK(amountMinor > 0), date INTEGER NOT NULL, accountId INTEGER NOT NULL REFERENCES accounts(id), transferAccountId INTEGER REFERENCES accounts(id), categoryId INTEGER REFERENCES categories(id) ON DELETE SET NULL, note TEXT, excludeFromReport INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'MANUAL');
      CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date);
      CREATE TABLE IF NOT EXISTS line_items (id INTEGER PRIMARY KEY, transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, name TEXT NOT NULL, amountMinor INTEGER NOT NULL, quantity REAL);
      CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS transaction_tags (transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(transactionId, tagId));
      CREATE TABLE IF NOT EXISTS transfer_candidates (id INTEGER PRIMARY KEY, outgoingTxnId INTEGER NOT NULL, incomingTxnId INTEGER NOT NULL, confidenceNote TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS moneylover_import_rows (rowKey TEXT PRIMARY KEY, transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0));
      CREATE TABLE IF NOT EXISTS lending_entries (id INTEGER PRIMARY KEY, personId INTEGER NOT NULL REFERENCES people(id), kind TEXT NOT NULL CHECK(kind IN ('LEND','BORROW','RECEIVE_REPAYMENT','REPAY','WRITE_OFF_LENT','WRITE_OFF_BORROWED')), transactionId INTEGER UNIQUE REFERENCES transactions(id) ON DELETE CASCADE, currencyCode TEXT NOT NULL, amountMinor INTEGER NOT NULL CHECK(amountMinor > 0), date INTEGER NOT NULL, note TEXT, CHECK((kind IN ('WRITE_OFF_LENT','WRITE_OFF_BORROWED') AND transactionId IS NULL) OR (kind IN ('LEND','BORROW','RECEIVE_REPAYMENT','REPAY') AND transactionId IS NOT NULL)));
      CREATE INDEX IF NOT EXISTS lending_entries_person ON lending_entries(personId);
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
      await db.runAsync(
        "INSERT INTO accounts (name, currencyCode, isFavorite) SELECT 'Cash', ?, 1 WHERE NOT EXISTS (SELECT 1 FROM accounts)",
        [defaultCurrencyCode],
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
    'SELECT id, name, currencyCode, isFavorite FROM accounts ORDER BY isFavorite DESC, name, id',
  );
}
export async function listCategories(type: 'EXPENSE' | 'INCOME') {
  return (await database()).getAllAsync<Category>(
    `SELECT c.id, c.name, c.type FROM categories c
    LEFT JOIN transactions t ON t.id = (
      SELECT id FROM transactions WHERE categoryId = c.id AND type = c.type ORDER BY date DESC, id DESC LIMIT 1
    ) WHERE c.type = ?
    ORDER BY t.date DESC, t.id DESC, c.name COLLATE NOCASE, c.id`,
    [type],
  );
}
export async function setFavoriteAccount(accountId: number) {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const account = await tx.getFirstAsync<{ id: number }>('SELECT id FROM accounts WHERE id = ?', [
      accountId,
    ]);
    if (!account) throw new Error('Account not found.');
    await tx.runAsync('UPDATE accounts SET isFavorite = CASE WHEN id = ? THEN 1 ELSE 0 END', [
      accountId,
    ]);
    const settings = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'backupSettings'",
    );
    if (settings) {
      await tx.runAsync("UPDATE app_settings SET value = ? WHERE key = 'backupSettings'", [
        JSON.stringify({ ...JSON.parse(settings.value), favoriteAccountId: accountId }),
      ]);
    }
  });
  notifyDataChanged();
}
export async function recentTransactions() {
  return (await database())
    .getAllAsync<TransactionRow>(`SELECT t.id, t.type, t.amountMinor, t.date, a.name AS accountName, c.name AS categoryName, t.note
    FROM transactions t JOIN accounts a ON a.id = t.accountId LEFT JOIN categories c ON c.id = t.categoryId ORDER BY t.date DESC, t.id DESC LIMIT 50`);
}
export function epochDay(date: Date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}
export function dateFromEpochDay(day: number) {
  const utc = new Date(day * 86400000);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12);
}
