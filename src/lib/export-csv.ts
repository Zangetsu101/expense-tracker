import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { database } from '@/lib/database';

type ExportRow = {
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amountMinor: number;
  date: number;
  accountName: string;
  currencyCode: string;
  destinationName: string | null;
  categoryName: string | null;
  note: string | null;
  excludeFromReport: number;
};

export const CSV_HEADER = 'Type,Amount,Currency,Account,Transfer Destination,Category,Date,Note,Exclude Report';

function field(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function formatTransactionsCsv(rows: ExportRow[]): string {
  return [CSV_HEADER, ...rows.map((row) => {
    const amount = (row.amountMinor / 100).toFixed(2);
    const signed = row.type === 'EXPENSE' ? `-${amount}` : row.type === 'INCOME' ? `+${amount}` : amount;
    const date = new Date(row.date * 86400000).toISOString().slice(0, 10);
    return [row.type, signed, row.currencyCode, row.accountName,
      row.destinationName ?? '', row.categoryName ?? '', date, row.note ?? '',
      row.excludeFromReport ? 'true' : 'false'].map(field).join(',');
  })].join('\r\n') + '\r\n';
}

export async function exportTransactionsCsv(name = 'expense-transactions.csv'): Promise<string | null> {
  if (Platform.OS !== 'android') throw new Error('CSV folder export is available on Android only.');
  const db = await database();
  const rows = await db.getAllAsync<ExportRow>(`SELECT t.type, t.amountMinor, t.date,
    a.name AS accountName, a.currencyCode, destination.name AS destinationName,
    c.name AS categoryName, t.note, t.excludeFromReport
    FROM transactions t JOIN accounts a ON a.id = t.accountId
    LEFT JOIN accounts destination ON destination.id = t.transferAccountId
    LEFT JOIN categories c ON c.id = t.categoryId
    ORDER BY t.date, t.id`);
  const csv = formatTransactionsCsv(rows);
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;
  const uri = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, name, 'text/csv');
  await FileSystem.writeAsStringAsync(uri, csv);
  return uri;
}
