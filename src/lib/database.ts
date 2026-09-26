import * as SQLite from 'expo-sqlite';

export type Account = { id: number; name: string; currencyCode: string };
export type Category = { id: number; name: string; type: 'EXPENSE' | 'INCOME' };
export type TransactionRow = {
  id: number; type: 'EXPENSE' | 'INCOME' | 'TRANSFER'; amountMinor: number;
  date: number; accountName: string; categoryName: string | null; note: string | null;
};

let connection: Promise<SQLite.SQLiteDatabase> | undefined;
export function database() {
  connection ??= SQLite.openDatabaseAsync('expense-poc.db').then(async (db) => {
    await db.execAsync(`PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, currencyCode TEXT NOT NULL, openingBalanceMinor INTEGER NOT NULL DEFAULT 0, isFavorite INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, parentId INTEGER REFERENCES categories(id) ON DELETE SET NULL, iconKey TEXT, needsReview INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, type TEXT NOT NULL, amountMinor INTEGER NOT NULL CHECK(amountMinor > 0), date INTEGER NOT NULL, accountId INTEGER NOT NULL REFERENCES accounts(id), transferAccountId INTEGER REFERENCES accounts(id), categoryId INTEGER REFERENCES categories(id) ON DELETE SET NULL, note TEXT, excludeFromReport INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'MANUAL');
      CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date);
      CREATE TABLE IF NOT EXISTS line_items (id INTEGER PRIMARY KEY, transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, name TEXT NOT NULL, amountMinor INTEGER NOT NULL, quantity REAL);
      CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS transaction_tags (transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(transactionId, tagId));
      CREATE TABLE IF NOT EXISTS transfer_candidates (id INTEGER PRIMARY KEY, outgoingTxnId INTEGER NOT NULL, incomingTxnId INTEGER NOT NULL, confidenceNote TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    await db.runAsync("INSERT INTO accounts (name, currencyCode, isFavorite) SELECT 'Cash', 'BDT', 1 WHERE NOT EXISTS (SELECT 1 FROM accounts)");
    await db.runAsync("INSERT INTO categories (name, type) SELECT 'Other', 'EXPENSE' WHERE NOT EXISTS (SELECT 1 FROM categories WHERE type = 'EXPENSE')");
    return db;
  }).catch((error) => { connection = undefined; throw error; });
  return connection;
}

export async function listAccounts() {
  return (await database()).getAllAsync<Account>('SELECT id, name, currencyCode FROM accounts ORDER BY isFavorite DESC, name');
}
export async function listCategories(type: 'EXPENSE' | 'INCOME') {
  return (await database()).getAllAsync<Category>('SELECT id, name, type FROM categories WHERE type = ? ORDER BY name', [type]);
}
export async function recentTransactions() {
  return (await database()).getAllAsync<TransactionRow>(`SELECT t.id, t.type, t.amountMinor, t.date, a.name AS accountName, c.name AS categoryName, t.note
    FROM transactions t JOIN accounts a ON a.id = t.accountId LEFT JOIN categories c ON c.id = t.categoryId ORDER BY t.date DESC, t.id DESC LIMIT 50`);
}
export function epochDay(date: Date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}
export async function addTransaction(input: { type: 'EXPENSE' | 'INCOME'; amountMinor: number; accountId: number; categoryId: number; note: string | null }) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('Enter a positive amount.');
  const db = await database();
  await db.runAsync('INSERT INTO transactions (type, amountMinor, date, accountId, categoryId, note) VALUES (?, ?, ?, ?, ?, ?)',
    [input.type, input.amountMinor, epochDay(new Date()), input.accountId, input.categoryId, input.note]);
}
