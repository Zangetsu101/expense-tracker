import { notifyDataChanged } from './data-changes.ts';
import { linkedAmountWarnings, type LendingResult } from './lending.ts';
import { database } from './database';
import type { LendingLabel } from './transaction-format';
import { parseQuickAddTags } from './quick-add-tags';
import { findOrCreateTag } from './tag-store';
import { accountTransactions, loadTransaction, updateTransaction } from './ledger-store.ts';
import type { Transaction } from './ledger.ts';

export type EditableTransaction = LendingLabel & {
  id: number;
  type: 'EXPENSE' | 'INCOME';
  amountMinor: number;
  date: number;
  accountId: number;
  personId?: number | null;
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

// Lending is never in reports, so its report exclusion is locked.
const editableRead = `SELECT t.id, t.type, t.amountMinor, t.date, t.accountId, t.categoryId,
  a.name AS accountName, a.currencyCode, c.name AS categoryName, t.note, t.excludeFromReport,
  t.personId, t.lendingKind, person.name AS personName,
  CASE WHEN t.kind = 'LENDING' THEN 1 ELSE 0 END AS reportExclusionLocked
  FROM ${accountTransactions} t JOIN accounts a ON a.id = t.accountId
  LEFT JOIN categories c ON c.id = t.categoryId
  LEFT JOIN people person ON person.id = t.personId
  WHERE t.id = ? AND t.type IN ('EXPENSE', 'INCOME')`;
type EditableRow = Omit<EditableTransaction, 'tags' | 'lineItems'>;

/** The Transaction with a new amount, note and report exclusion. */
function edited(
  transaction: Transaction,
  amountMinor: number,
  note: string | null,
  excludeFromReport: boolean,
): Transaction {
  switch (transaction.kind) {
    case 'EXPENSE':
    case 'INCOME':
    case 'REIMBURSEMENT':
      return { ...transaction, amountMinor, note, excludeFromReport };
    case 'LENDING':
      return { ...transaction, amountMinor, note };
    default:
      throw new Error('Transfers cannot be edited here.');
  }
}

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
  const row = await db.getFirstAsync<EditableRow>(editableRead, [id]);
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
  amountMinor: number = original.amountMinor,
  options: { confirmOverpayment?: boolean } = {},
): Promise<Extract<LendingResult, { status: 'confirmation_required' }> | void> {
  validId(original.id);
  if (original.type !== 'EXPENSE' && original.type !== 'INCOME')
    throw new Error('Transfers cannot be edited here.');
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
    throw new Error('Enter a positive amount.');
  validateLineItems(lineItems);
  const originalIds = new Set(original.lineItems.map((item) => item.id));
  if (lineItems.some((item) => item.id !== undefined && !originalIds.has(item.id)))
    throw new Error('Unknown line item ID.');
  const names = tagText.trim() ? parseQuickAddTags(tagText) : [];
  const db = await database();
  let outcome: Extract<LendingResult, { status: 'confirmation_required' }> | undefined;
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (amountMinor !== original.amountMinor && !options.confirmOverpayment) {
      const warnings = await linkedAmountWarnings(tx, original.id, amountMinor);
      if (warnings.length) {
        outcome = { status: 'confirmation_required', warnings };
        return;
      }
    }
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
    const [row, transaction] = await Promise.all([
      tx.getFirstAsync<EditableRow>(editableRead, [original.id]),
      loadTransaction(tx, original.id),
    ]);
    if (
      !row ||
      !transaction ||
      row.type !== original.type ||
      row.amountMinor !== original.amountMinor ||
      row.date !== original.date ||
      row.accountId !== original.accountId ||
      row.categoryId !== original.categoryId ||
      row.note !== original.note ||
      row.excludeFromReport !== original.excludeFromReport ||
      row.personId !== (original.personId ?? null) ||
      row.lendingKind !== (original.lendingKind ?? null)
    )
      throw new Error('Transaction was changed or removed. Reload before saving.');
    await updateTransaction(
      tx,
      edited(transaction, amountMinor, note.trim() || null, excludeFromReport),
    );
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
  if (!outcome) notifyDataChanged();
  return outcome;
}
