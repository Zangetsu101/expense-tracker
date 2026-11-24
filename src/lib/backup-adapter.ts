import { notifyDataChanged } from './data-changes.ts';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { database, favoriteAccountIdSql, isFavoriteSql } from '@/lib/database';
import { accountTransactions, lendingEntryRows } from '@/lib/ledger-store';
import { restoreLegacyRows } from '@/lib/legs-migration';
import { readAll } from '@/lib/read-all';
import type { BackupData, BackupDocuments, BackupStore } from '@/lib/backup';

// The backup format stays v1 (ADR 0013). Export derives the v1 rows from the legs, and
// restore loads the v1 rows with the same fill SQL as the migration.
//
// A v1 lending entry needs an id. Each entry uses the id of its Transaction, so the ids
// stay the same from one export to the next. A restore gives each Write-off a new
// Transaction id after the highest id of the other Transactions.

/** The v1 Transactions: every Transaction that moves money on an Account. */
const v1Transactions = `SELECT t.id, t.type, t.amountMinor, t.receivedAmountMinor,
  t.date AS dateEpochDay, t.accountId, t.transferAccountId, t.categoryId, t.note,
  t.excludeFromReport FROM ${accountTransactions} t ORDER BY t.id`;

export const backupStore: BackupStore = {
  async snapshot() {
    const db = await database();
    let snapshot!: BackupData;
    await db.withExclusiveTransactionAsync(async (tx) => {
      const all = <T>(query: string) => tx.getAllAsync<T>(query);
      const { favorite, displayRate, accounts, categories, transactions, ...tables } =
        await readAll({
          favorite: tx.getFirstAsync<{ id: number | null }>(`SELECT ${favoriteAccountIdSql} AS id`),
          displayRate: tx.getFirstAsync<{ value: string }>(
            "SELECT value FROM app_settings WHERE key = 'displayRate'",
          ),
          accounts: all<
            Omit<BackupData['accounts'][number], 'isFavorite'> & { isFavorite: number }
          >(
            `SELECT a.id, a.name, a.currencyCode, a.openingBalanceMinor,
            ${isFavoriteSql('a')} AS isFavorite FROM accounts a ORDER BY a.id`,
          ),
          categories: all<BackupData['categories'][number]>(
            'SELECT id, name, type, parentId, iconKey FROM categories ORDER BY id',
          ),
          transactions: all<
            Omit<BackupData['transactions'][number], 'excludeFromReport' | 'source'> & {
              excludeFromReport: number;
            }
          >(v1Transactions),
          lineItems: all<BackupData['lineItems'][number]>(
            'SELECT id, transactionId, name, amountMinor, quantity FROM line_items ORDER BY id',
          ),
          tags: all<BackupData['tags'][number]>('SELECT id, name FROM tags ORDER BY id'),
          transactionTags: all<BackupData['transactionTags'][number]>(
            'SELECT transactionId, tagId FROM transaction_tags ORDER BY transactionId, tagId',
          ),
          creditCards: all<NonNullable<BackupData['creditCards']>[number]>(
            'SELECT accountId, parentAccountId, statementDay, dueDay FROM credit_cards ORDER BY accountId',
          ),
          people: all<NonNullable<BackupData['people']>[number]>(
            'SELECT id, name FROM people ORDER BY id',
          ),
          splitShares: all<NonNullable<BackupData['splitShares']>[number]>(
            'SELECT expenseId, personId, amountMinor FROM split_shares ORDER BY expenseId, personId',
          ),
          reimbursements: all<NonNullable<BackupData['reimbursements']>[number]>(
            'SELECT transactionId, expenseId, personId FROM reimbursements ORDER BY transactionId',
          ),
          lendingEntries: all<NonNullable<BackupData['lendingEntries']>[number]>(
            `SELECT id, personId, kind, transactionId, currencyCode, amountMinor,
            date AS dateEpochDay, note FROM (${lendingEntryRows}) ORDER BY id`,
          ),
        });
      snapshot = {
        schemaVersion: 1,
        ...tables,
        accounts: accounts.map((row) => ({ ...row, isFavorite: Boolean(row.isFavorite) })),
        categories: categories.map((row) => ({ ...row, needsReview: false })),
        transactions: transactions.map(({ receivedAmountMinor, ...row }) => ({
          ...row,
          ...(receivedAmountMinor === null ? {} : { receivedAmountMinor }),
          excludeFromReport: Boolean(row.excludeFromReport),
          source: 'MANUAL',
        })),
        transferCandidates: [],
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
    await db.withExclusiveTransactionAsync((tx) => restoreLegacyRows(tx, data));
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
