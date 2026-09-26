import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { database } from '@/lib/database';
import { parseMoneyLoverCsv } from '@/lib/csv';
import { importRowKeys } from '@/lib/import-dedupe';

export async function importMoneyLoverFile(): Promise<number | null> {
  const selected = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', '*/*'], copyToCacheDirectory: false });
  if (selected.canceled) return null;
  const rows = parseMoneyLoverCsv(await new File(selected.assets[0].uri).text());
  if (!rows.length) throw new Error('No valid MoneyLover rows found.');
  const keys = importRowKeys(rows);
  const db = await database();
  let inserted = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.execAsync('CREATE TABLE IF NOT EXISTS moneylover_import_rows (rowKey TEXT PRIMARY KEY, transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE)');
    for (const [index, row] of rows.entries()) {
      const currency = row.currency.trim().toUpperCase();
      if (!row.account || !currency || !row.category || !Number.isSafeInteger(row.amount * 100) || row.amount === 0) throw new Error('CSV contains an unsupported account, category, or amount.');
      const existing = await tx.getFirstAsync('SELECT 1 FROM moneylover_import_rows WHERE rowKey = ?', [keys[index]]);
      if (existing) continue;
      const type = row.amount < 0 ? 'EXPENSE' : 'INCOME';
      let account = await tx.getFirstAsync<{ id: number; currencyCode: string }>('SELECT id, currencyCode FROM accounts WHERE name = ? COLLATE NOCASE', [row.account]);
      if (account && account.currencyCode !== currency) throw new Error(`Account ${row.account} uses a different currency.`);
      if (!account) {
        const result = await tx.runAsync('INSERT INTO accounts (name, currencyCode) VALUES (?, ?)', [row.account, currency]);
        account = { id: result.lastInsertRowId, currencyCode: currency };
      }
      let category = await tx.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND type = ?', [row.category, type]);
      if (!category) {
        const result = await tx.runAsync('INSERT INTO categories (name, type) VALUES (?, ?)', [row.category, type]);
        category = { id: result.lastInsertRowId };
      }
      const epochDay = Date.parse(`${row.date}T00:00:00Z`) / 86400000;
      const transaction = await tx.runAsync('INSERT INTO transactions (type, amountMinor, date, accountId, categoryId, note, excludeFromReport, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [type, Math.abs(row.amount * 100), epochDay, account.id, category.id, row.note || null, Number(row.excludeFromReport), 'IMPORT']);
      await tx.runAsync('INSERT INTO moneylover_import_rows (rowKey, transactionId) VALUES (?, ?)', [keys[index], transaction.lastInsertRowId]);
      inserted++;
    }
  });
  return inserted;
}
