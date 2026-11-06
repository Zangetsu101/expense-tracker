import { database } from './database';
import type { LendingLabel } from './transaction-format';
import { parseQuickAddTags } from './quick-add-tags';
import { findOrCreateTag } from './tag-store';

export type EditableTransaction = LendingLabel & {
  id: number;
  type: 'EXPENSE' | 'INCOME';
  amountMinor: number;
  date: number;
  accountId: number;
  categoryId: number | null;
  accountName: string;
  currencyCode: string;
  categoryName: string | null;
  note: string | null;
  excludeFromReport: number;
  reportExclusionLocked: number;
  tags: { id: number; name: string }[];
  lineItems: LineItem[];
};

export type LineItem = { id?: number; name: string; amountMinor: number; quantity: number | null };

const principalReportExclusion = `EXISTS (SELECT 1 FROM lending_entries WHERE transactionId = t.id)
  OR (t.source = 'IMPORT' AND EXISTS (SELECT 1 FROM categories c WHERE c.id = t.categoryId AND
    ((t.type = 'EXPENSE' AND lower(trim(c.name)) IN ('loan', 'repayment')) OR
     (t.type = 'INCOME' AND lower(trim(c.name)) IN ('debt', 'debt collection')))))`;

function validateLineItems(items: LineItem[]) {
  const ids = new Set<number>();
  for (const item of items) {
    if (item.id !== undefined) {
      if (!Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id))
        throw new Error('Invalid line item ID.');
      ids.add(item.id);
    }
    if (!item.name.trim()) throw new Error('Line item name is required.');
    if (!Number.isSafeInteger(item.amountMinor))
      throw new Error('Line item amount must be a safe integer.');
    if (item.quantity !== null && (!Number.isFinite(item.quantity) || item.quantity <= 0))
      throw new Error('Line item quantity must be positive and finite.');
  }
}

function validId(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid transaction ID.');
}

export async function loadEditableTransaction(id: number): Promise<EditableTransaction | null> {
  validId(id);
  const db = await database();
  const row = await db.getFirstAsync<Omit<EditableTransaction, 'tags' | 'lineItems'>>(
    `SELECT t.id, t.type, t.amountMinor, t.date, t.accountId, t.categoryId, a.name AS accountName,
    a.currencyCode, c.name AS categoryName, t.note, t.excludeFromReport,
    lending.kind AS lendingKind, person.name AS personName,
    CASE WHEN ${principalReportExclusion} THEN 1 ELSE 0 END AS reportExclusionLocked
    FROM transactions t JOIN accounts a ON a.id = t.accountId
    LEFT JOIN categories c ON c.id = t.categoryId
    LEFT JOIN lending_entries lending ON lending.transactionId = t.id
    LEFT JOIN people person ON person.id = lending.personId
    WHERE t.id = ? AND t.type IN ('EXPENSE', 'INCOME')`,
    [id],
  );
  if (!row) return null;
  const tags = await db.getAllAsync<{ id: number; name: string }>(
    `SELECT tags.id, tags.name FROM tags
    JOIN transaction_tags tt ON tt.tagId = tags.id WHERE tt.transactionId = ? ORDER BY tags.id`,
    [id],
  );
  const lineItems = await db.getAllAsync<Required<LineItem>>(
    'SELECT id, name, amountMinor, quantity FROM line_items WHERE transactionId = ? ORDER BY id',
    [id],
  );
  return { ...row, tags, lineItems };
}

export async function saveTransactionEdit(
  original: EditableTransaction,
  note: string,
  excludeFromReport: boolean,
  tagText: string,
  lineItems: LineItem[] = original.lineItems,
) {
  validId(original.id);
  if (original.type !== 'EXPENSE' && original.type !== 'INCOME')
    throw new Error('Transfers cannot be edited here.');
  validateLineItems(lineItems);
  const originalIds = new Set(original.lineItems.map((item) => item.id));
  if (lineItems.some((item) => item.id !== undefined && !originalIds.has(item.id)))
    throw new Error('Unknown line item ID.');
  const names = tagText.trim() ? parseQuickAddTags(tagText) : [];
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await tx.getAllAsync<{ id: number; name: string }>(
      `SELECT tags.id, tags.name FROM tags
      JOIN transaction_tags tt ON tt.tagId = tags.id WHERE tt.transactionId = ? ORDER BY tags.id`,
      [original.id],
    );
    if (
      current.length !== original.tags.length ||
      current.some((tag, index) => tag.id !== original.tags[index].id)
    ) {
      throw new Error('Transaction was changed or removed. Reload before saving.');
    }
    const currentItems = await tx.getAllAsync<Required<LineItem>>(
      'SELECT id, name, amountMinor, quantity FROM line_items WHERE transactionId = ? ORDER BY id',
      [original.id],
    );
    if (
      currentItems.length !== original.lineItems.length ||
      currentItems.some((item, index) => {
        const previous = original.lineItems[index];
        return (
          item.id !== previous.id ||
          item.name !== previous.name ||
          item.amountMinor !== previous.amountMinor ||
          item.quantity !== previous.quantity
        );
      })
    )
      throw new Error('Transaction was changed or removed. Reload before saving.');
    const result = await tx.runAsync(
      `UPDATE transactions AS t SET note = ?, excludeFromReport = CASE
        WHEN ${principalReportExclusion} THEN 1 ELSE ? END
      WHERE id = ? AND type = ? AND amountMinor = ? AND date = ? AND accountId = ?
        AND categoryId IS ? AND note IS ? AND excludeFromReport = ?`,
      [
        note.trim() || null,
        Number(excludeFromReport),
        original.id,
        original.type,
        original.amountMinor,
        original.date,
        original.accountId,
        original.categoryId,
        original.note,
        original.excludeFromReport,
      ],
    );
    if (result.changes !== 1)
      throw new Error('Transaction was changed or removed. Reload before saving.');
    const ids: number[] = [];
    for (const name of names) {
      ids.push(await findOrCreateTag(tx, name));
    }
    await tx.runAsync('DELETE FROM transaction_tags WHERE transactionId = ?', [original.id]);
    for (const tagId of ids)
      await tx.runAsync('INSERT INTO transaction_tags (transactionId, tagId) VALUES (?, ?)', [
        original.id,
        tagId,
      ]);
    await tx.runAsync('DELETE FROM line_items WHERE transactionId = ?', [original.id]);
    // Reinsert retained IDs before auto-assigning IDs to new Line Items.
    for (const item of lineItems.filter((entry) => entry.id !== undefined)) {
      await tx.runAsync(
        'INSERT INTO line_items (id, transactionId, name, amountMinor, quantity) VALUES (?, ?, ?, ?, ?)',
        [item.id!, original.id, item.name.trim(), item.amountMinor, item.quantity],
      );
    }
    for (const item of lineItems.filter((entry) => entry.id === undefined)) {
      await tx.runAsync(
        'INSERT INTO line_items (transactionId, name, amountMinor, quantity) VALUES (?, ?, ?, ?)',
        [original.id, item.name.trim(), item.amountMinor, item.quantity],
      );
    }
  });
}
