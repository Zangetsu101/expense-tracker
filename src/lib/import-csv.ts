import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { database } from '@/lib/database';
import { parseMoneyLoverCsv, type MoneyLoverRow } from '@/lib/csv';
import { hasAmbiguousLegacyImport, importRowKeys, type LegacyImportRow } from '@/lib/import-dedupe';
import { classifyTransferPairs } from '@/lib/transfer-matching';
import { planImportCategories } from '@/lib/import-categories';

/** Confirmation means the user accepts separate Expense and Income categories for these names. */
export async function importMoneyLoverFile(confirmMixedCategories?: (names: string[]) => Promise<boolean>): Promise<number | null> {
  const selected = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', '*/*'], copyToCacheDirectory: false });
  if (selected.canceled) return null;
  const rows = parseMoneyLoverCsv(await new File(selected.assets[0].uri).text());
  if (!rows.length) throw new Error('No valid MoneyLover rows found.');
  const keys = importRowKeys(rows);
  const indices = new Map(rows.map((row, index) => [row, index]));
  const matches = classifyTransferPairs(rows);
  for (const row of rows) {
    const currency = row.currency.trim().toUpperCase();
    if (!row.account || !currency || !row.category || !Number.isSafeInteger(row.amountMinor) || row.amountMinor === 0) throw new Error('CSV contains an unsupported account, category, or amount.');
  }
  const db = await database();
  const alreadyImported = new Map((await db.getAllAsync<{ rowKey: string; transactionId: number }>(
    'SELECT rowKey, transactionId FROM moneylover_import_rows')).map((row) => [row.rowKey, row.transactionId]));
  const categoryRows = [...matches.singleSided];
  for (const pair of matches.highConfidence) {
    const outgoingId = alreadyImported.get(keys[indices.get(pair.outgoing)!]);
    const incomingId = alreadyImported.get(keys[indices.get(pair.incoming)!]);
    if (outgoingId || incomingId) categoryRows.push(pair.outgoing, pair.incoming);
  }
  const plan = planImportCategories(categoryRows);
  const mixed = plan.categories.filter((category) => category.needsConfirmation &&
    categoryRows.some((row) => row.category.trim() === category.name && !alreadyImported.has(keys[indices.get(row)!])))
    .map((category) => category.name);
  if (mixed.length && (!confirmMixedCategories || !(await confirmMixedCategories(mixed)))) {
    throw new Error(`Mixed Categories require confirmation before import: ${mixed.join(', ')}.`);
  }

  let inserted = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const legacy = await tx.getAllAsync<LegacyImportRow>(`SELECT t.date, a.name AS account, a.currencyCode AS currency, c.name AS category,
      t.amountMinor, t.type, t.note, t.excludeFromReport FROM transactions t
      JOIN accounts a ON a.id = t.accountId LEFT JOIN categories c ON c.id = t.categoryId
      WHERE t.type IN ('EXPENSE', 'INCOME') AND NOT EXISTS
      (SELECT 1 FROM moneylover_import_rows r WHERE r.transactionId = t.id)`);
    if (hasAmbiguousLegacyImport(rows, legacy)) {
      throw new Error('CSV overlaps existing Transactions without row identities. Import stopped to avoid duplicates; review the existing data before retrying.');
    }
    const existing = new Map<string, number>();
    for (const key of keys) {
      const found = await tx.getFirstAsync<{ transactionId: number }>('SELECT transactionId FROM moneylover_import_rows WHERE rowKey = ?', [key]);
      if (found) existing.set(key, found.transactionId);
    }
    const id = (row: MoneyLoverRow) => indices.get(row)!;
    const merged = new Set<number>();
    const reviewPairs = [...matches.uncertain];
    for (const pair of matches.highConfidence) {
      const out = id(pair.outgoing);
      const inc = id(pair.incoming);
      const oldOut = existing.get(keys[out]);
      const oldInc = existing.get(keys[inc]);
      if (oldOut || oldInc) {
        const oldId = oldOut ?? oldInc!;
        const stored = await tx.getFirstAsync<{ type: string; amountMinor: number; date: number; sourceName: string; destinationName: string; currency: string }>(`SELECT t.type, t.amountMinor, t.date, a.name AS sourceName, b.name AS destinationName, a.currencyCode AS currency
          FROM transactions t JOIN accounts a ON a.id = t.accountId LEFT JOIN accounts b ON b.id = t.transferAccountId WHERE t.id = ?`, [oldId]);
        if (stored?.type === 'TRANSFER' && stored.amountMinor === Math.abs(pair.outgoing.amountMinor) && stored.date === day(pair.outgoing) &&
            stored.sourceName.toLowerCase() === pair.outgoing.account.toLowerCase() && stored.destinationName?.toLowerCase() === pair.incoming.account.toLowerCase() &&
            stored.currency === pair.outgoing.currency.trim().toUpperCase() && (!oldOut || !oldInc || oldOut === oldInc)) {
          for (const index of [out, inc]) {
            if (!existing.has(keys[index])) await tx.runAsync('INSERT INTO moneylover_import_rows (rowKey, transactionId) VALUES (?, ?)', [keys[index], oldId]);
            merged.add(index);
          }
        } else {
          reviewPairs.push(pair);
        }
        continue;
      }
      const source = await accountId(pair.outgoing);
      const destination = await accountId(pair.incoming);
      const transaction = await tx.runAsync(`INSERT INTO transactions (type, amountMinor, date, accountId, transferAccountId, categoryId, note, excludeFromReport, source)
        VALUES ('TRANSFER', ?, ?, ?, ?, NULL, ?, ?, 'IMPORT')`,
        [Math.abs(pair.outgoing.amountMinor), day(pair.outgoing), source, destination,
          pair.outgoing.note || pair.incoming.note || null, Number(pair.outgoing.excludeFromReport || pair.incoming.excludeFromReport)]);
      for (const index of [out, inc]) {
        await tx.runAsync('INSERT INTO moneylover_import_rows (rowKey, transactionId) VALUES (?, ?)', [keys[index], transaction.lastInsertRowId]);
        merged.add(index);
      }
      inserted++;
    }
    for (const [index, row] of rows.entries()) {
      if (merged.has(index) || existing.has(keys[index])) continue;
      const type = row.amountMinor < 0 ? 'EXPENSE' : 'INCOME';
      const account = await accountId(row);
      const category = await categoryId(row.category, type);
      const transaction = await tx.runAsync(`INSERT INTO transactions (type, amountMinor, date, accountId, categoryId, note, excludeFromReport, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'IMPORT')`,
        [type, Math.abs(row.amountMinor), day(row), account, category, row.note || null, Number(row.excludeFromReport)]);
      await tx.runAsync('INSERT INTO moneylover_import_rows (rowKey, transactionId) VALUES (?, ?)', [keys[index], transaction.lastInsertRowId]);
      existing.set(keys[index], transaction.lastInsertRowId);
      inserted++;
    }
    const candidateEdges = new Set<string>();
    for (const pair of reviewPairs) {
      const outgoing = existing.get(keys[id(pair.outgoing)]);
      const incoming = existing.get(keys[id(pair.incoming)]);
      if (!outgoing || !incoming || outgoing === incoming) continue;
      const edge = `${outgoing}:${incoming}`;
      if (candidateEdges.has(edge)) continue;
      candidateEdges.add(edge);
      const found = await tx.getFirstAsync('SELECT 1 FROM transfer_candidates WHERE outgoingTxnId = ? AND incomingTxnId = ?', [outgoing, incoming]);
      if (!found) await tx.runAsync('INSERT INTO transfer_candidates (outgoingTxnId, incomingTxnId, confidenceNote) VALUES (?, ?, ?)',
        [outgoing, incoming, 'Same date, amount and currency on different accounts; needs review.']);
    }

    async function accountId(row: MoneyLoverRow): Promise<number> {
      const currency = row.currency.trim().toUpperCase();
      const account = await tx.getFirstAsync<{ id: number; currencyCode: string }>('SELECT id, currencyCode FROM accounts WHERE name = ? COLLATE NOCASE', [row.account]);
      if (account) {
        if (account.currencyCode !== currency) throw new Error(`Account ${row.account} uses a different currency.`);
        return account.id;
      }
      return (await tx.runAsync('INSERT INTO accounts (name, currencyCode) VALUES (?, ?)', [row.account, currency])).lastInsertRowId;
    }
    async function categoryId(name: string, type: 'EXPENSE' | 'INCOME'): Promise<number> {
      const found = await tx.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND type = ?', [name, type]);
      if (found) return found.id;
      const parentName = plan.categories.find((category) => category.name === name && category.type === type)?.parent;
      let parentId: number | null = null;
      if (parentName) {
        const parent = await tx.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND type = ?', [parentName, type]);
        parentId = parent?.id ?? (await tx.runAsync('INSERT INTO categories (name, type) VALUES (?, ?)', [parentName, type])).lastInsertRowId;
      }
      return (await tx.runAsync('INSERT INTO categories (name, type, parentId) VALUES (?, ?, ?)', [name, type, parentId])).lastInsertRowId;
    }
  });
  return inserted;
}

function day(row: MoneyLoverRow): number {
  return Date.parse(`${row.date}T00:00:00Z`) / 86400000;
}
