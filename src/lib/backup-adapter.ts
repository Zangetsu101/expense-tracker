import { notifyDataChanged } from './data-changes.ts';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { database, favoriteAccountIdSql } from '@/lib/database';
import { restoreLegsRows } from '@/lib/backup-restore';
import { restoreLegacyRows } from '@/lib/backup-v1-restore';
import { backupV2Tables, backupV3Tables, type BackupV2, type BackupV3 } from '@/lib/backup-v2';
import { legOrder } from '@/lib/ledger-store';
import { readAll } from '@/lib/read-all';
import type { BackupDocuments, BackupStore } from '@/lib/backup';

/** Selects the fields in a backup table in their export order. */
function selectBackupRows({
  table,
  uniqueKey,
  fields,
}: {
  table: string;
  uniqueKey: readonly string[];
  fields: object;
}) {
  // A Leg has no unique key, so the Legs of a Transaction come in the order that the app
  // reads them in (ADR 0014).
  const order = table === 'legs' ? `transactionId, ${legOrder}` : uniqueKey.join(', ');
  return `SELECT ${Object.keys(fields).join(', ')} FROM ${table} ORDER BY ${order}`;
}

export const backupStore: BackupStore = {
  async snapshot() {
    const db = await database();
    let snapshot!: BackupV2 | BackupV3;
    await db.withExclusiveTransactionAsync(async (tx) => {
      const hasInvestments = !!(await tx.getFirstAsync('SELECT 1 FROM investments LIMIT 1'));
      const backupTables = hasInvestments ? backupV3Tables : backupV2Tables;
      const { favorite, displayRate, tables } = await readAll({
        favorite: tx.getFirstAsync<{ id: number | null }>(`SELECT ${favoriteAccountIdSql} AS id`),
        displayRate: tx.getFirstAsync<{ value: string }>(
          "SELECT value FROM app_settings WHERE key = 'displayRate'",
        ),
        tables: readAll(
          Object.fromEntries(
            Object.entries(backupTables).map(([name, table]) => [
              name,
              tx.getAllAsync(selectBackupRows(table)),
            ]),
          ),
        ),
      });
      const rows = tables as Omit<BackupV3, 'schemaVersion' | 'settings'>;
      snapshot = {
        schemaVersion: hasInvestments ? 3 : 2,
        ...rows,
        transactions: rows.transactions.map((row) => ({
          ...row,
          excludeFromReport: Boolean(row.excludeFromReport),
        })),
        settings: {
          favoriteAccountId: favorite?.id ?? null,
          displayRate: displayRate ? JSON.parse(displayRate.value) : null,
        },
      };
    });
    return snapshot;
  },
  async replace(data) {
    const db = await database();
    await db.withExclusiveTransactionAsync((tx) =>
      data.schemaVersion === 1 ? restoreLegacyRows(tx, data) : restoreLegsRows(tx, data),
    );
    notifyDataChanged();
  },
};

export const backupDocuments: BackupDocuments = {
  async shareJson(name, text) {
    if (!(await Sharing.isAvailableAsync()))
      throw new Error('Sharing is unavailable on this device.');
    const uri = `${FileSystem.cacheDirectory}${name}`;
    await FileSystem.writeAsStringAsync(uri, text);
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Save backup' });
  },
  async pickJsonDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: false,
    });
    if (result.canceled) return null;
    const { uri, name } = result.assets[0];
    return { uri, name };
  },
  readText: (uri) => new File(uri).text(),
};
