import { notifyDataChanged } from './data-changes.ts';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { database } from '@/lib/database';
import type { BackupData, BackupDocuments, BackupStore } from '@/lib/backup';

const tables = [
  ['accounts', 'accounts'],
  ['categories', 'categories'],
  ['transactions', 'transactions'],
  ['lineItems', 'line_items'],
  ['tags', 'tags'],
  ['transactionTags', 'transaction_tags'],
  ['transferCandidates', 'transfer_candidates'],
] as const;
const boolFields = ['isFavorite', 'needsReview', 'excludeFromReport', 'resolved'];
const columnsByTable: Record<string, readonly string[]> = {
  accounts: ['id', 'name', 'currencyCode', 'openingBalanceMinor', 'isFavorite'],
  categories: ['id', 'name', 'type', 'parentId', 'iconKey', 'needsReview'],
  transactions: [
    'id',
    'type',
    'amountMinor',
    'date',
    'accountId',
    'transferAccountId',
    'categoryId',
    'note',
    'excludeFromReport',
    'source',
  ],
  line_items: ['id', 'transactionId', 'name', 'amountMinor', 'quantity'],
  tags: ['id', 'name'],
  transaction_tags: ['transactionId', 'tagId'],
  transfer_candidates: ['id', 'outgoingTxnId', 'incomingTxnId', 'confidenceNote', 'resolved'],
};

export const backupStore: BackupStore = {
  async snapshot() {
    const db = await database();
    let snapshot!: BackupData;
    await db.withExclusiveTransactionAsync(async (tx) => {
      const data: Record<string, unknown> = { schemaVersion: 1 };
      for (const [key, table] of tables) {
        const rows = await tx.getAllAsync<Record<string, unknown>>(
          `SELECT * FROM ${table} ORDER BY ${table === 'transaction_tags' ? 'transactionId, tagId' : 'id'}`,
        );
        data[key] = rows.map((row) => {
          const result = { ...row };
          for (const field of boolFields)
            if (field in result) result[field] = Boolean(result[field]);
          if (table === 'transactions') {
            result.dateEpochDay = result.date;
            delete result.date;
          }
          return result;
        });
      }
      data.moneyLoverImportRows = await tx.getAllAsync<{ rowKey: string; transactionId: number }>(
        'SELECT rowKey, transactionId FROM moneylover_import_rows ORDER BY rowKey',
      );
      data.people = await tx.getAllAsync('SELECT id, name FROM people ORDER BY id');
      data.lendingEntries = await tx.getAllAsync(`SELECT e.id, e.personId, e.kind, e.transactionId,
      CASE WHEN t.id IS NULL THEN e.currencyCode ELSE a.currencyCode END AS currencyCode,
      COALESCE(t.amountMinor, e.amountMinor) AS amountMinor, COALESCE(t.date, e.date) AS dateEpochDay,
      CASE WHEN t.id IS NULL THEN e.note ELSE t.note END AS note
      FROM lending_entries e LEFT JOIN transactions t ON t.id = e.transactionId
      LEFT JOIN accounts a ON a.id = t.accountId ORDER BY e.id`);
      const favorite = await tx.getFirstAsync<{ id: number }>(
        'SELECT id FROM accounts WHERE isFavorite = 1 LIMIT 1',
      );
      const settings = await tx.getFirstAsync<{ value: string }>(
        "SELECT value FROM app_settings WHERE key = 'backupSettings'",
      );
      data.settings = settings
        ? JSON.parse(settings.value)
        : { favoriteAccountId: favorite?.id ?? null, displayRate: null };
      snapshot = data as unknown as BackupData;
    });
    return snapshot;
  },
  async replace(data) {
    const db = await database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(
        'DELETE FROM lending_entries; DELETE FROM people; DELETE FROM moneylover_import_rows',
      );
      for (const table of [
        'transaction_tags',
        'transfer_candidates',
        'line_items',
        'transactions',
        'tags',
        'categories',
        'accounts',
      ])
        await tx.execAsync(`DELETE FROM ${table}`);
      for (const [key, table] of tables) {
        for (const row of data[key]) {
          const values = { ...row } as Record<string, unknown>;
          if (table === 'transactions') {
            values.date = values.dateEpochDay;
            delete values.dateEpochDay;
          }
          if (table === 'categories') values.parentId = null;
          const columns = Object.keys(values).filter((column) =>
            columnsByTable[table].includes(column),
          );
          await tx.runAsync(
            `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
            columns.map((column) =>
              typeof values[column] === 'boolean'
                ? Number(values[column])
                : (values[column] as SQLiteValue),
            ),
          );
        }
      }
      for (const category of data.categories) {
        if (category.parentId != null)
          await tx.runAsync('UPDATE categories SET parentId = ? WHERE id = ?', [
            category.parentId,
            category.id,
          ]);
      }
      for (const row of data.moneyLoverImportRows ?? []) {
        await tx.runAsync(
          'INSERT INTO moneylover_import_rows (rowKey, transactionId) VALUES (?, ?)',
          [row.rowKey, row.transactionId],
        );
      }
      for (const person of data.people ?? []) {
        await tx.runAsync('INSERT INTO people (id, name) VALUES (?, ?)', [person.id, person.name]);
      }
      for (const entry of data.lendingEntries ?? []) {
        await tx.runAsync(
          'INSERT INTO lending_entries (id, personId, kind, transactionId, currencyCode, amountMinor, date, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            entry.id,
            entry.personId,
            entry.kind,
            entry.transactionId,
            entry.currencyCode,
            entry.amountMinor,
            entry.dateEpochDay,
            entry.note,
          ],
        );
      }
      await tx.runAsync(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('backupSettings', ?)",
        [JSON.stringify(data.settings)],
      );
    });
    notifyDataChanged();
  },
};
type SQLiteValue = string | number | null;

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
