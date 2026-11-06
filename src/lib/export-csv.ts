import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
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

export const CSV_HEADER =
  'Type,Amount,Currency,Account,Transfer Destination,Category,Date,Note,Exclude Report';

function field(value: string, userText = false): string {
  const safe = userText && /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function decimalMinor(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('CSV contains an unsupported amount.');
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

export function formatTransactionsCsv(rows: ExportRow[]): string {
  return (
    [
      CSV_HEADER,
      ...rows.map((row) => {
        const amount = decimalMinor(row.amountMinor);
        const signed =
          row.type === 'EXPENSE' ? `-${amount}` : row.type === 'INCOME' ? `+${amount}` : amount;
        const date = new Date(row.date * 86400000).toISOString().slice(0, 10);
        return [
          field(row.type),
          field(signed),
          field(row.currencyCode),
          field(row.accountName, true),
          field(row.destinationName ?? '', true),
          field(row.categoryName ?? '', true),
          field(date),
          field(row.note ?? '', true),
          field(row.excludeFromReport ? 'true' : 'false'),
        ].join(',');
      }),
    ].join('\r\n') + '\r\n'
  );
}

export async function exportTransactionsCsv(
  name = 'expense-transactions.csv',
): Promise<string | null> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios')
    throw new Error('CSV export requires Android or iOS.');
  const db = await database();
  const rows = await db.getAllAsync<ExportRow>(`SELECT t.type, t.amountMinor, t.date,
    a.name AS accountName, a.currencyCode, destination.name AS destinationName,
    c.name AS categoryName, t.note, t.excludeFromReport
    FROM transactions t JOIN accounts a ON a.id = t.accountId
    LEFT JOIN accounts destination ON destination.id = t.transferAccountId
    LEFT JOIN categories c ON c.id = t.categoryId
    ORDER BY t.date, t.id`);
  const csv = formatTransactionsCsv(rows);
  if (Platform.OS === 'ios') {
    if (!(await Sharing.isAvailableAsync()))
      throw new Error('CSV sharing is unavailable on this device.');
    const uri = `${FileSystem.cacheDirectory}expense-transactions-${Date.now()}.csv`;
    await FileSystem.writeAsStringAsync(uri, csv);
    await Sharing.shareAsync(uri, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    });
    return uri;
  }
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;
  const uri = await FileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    name,
    'text/csv',
  );
  await FileSystem.writeAsStringAsync(uri, csv);
  return uri;
}
