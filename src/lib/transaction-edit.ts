import { database } from './database';

export type EditableTransaction = {
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
};

function validId(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid transaction ID.');
}

export async function loadEditableTransaction(id: number): Promise<EditableTransaction | null> {
  validId(id);
  const db = await database();
  return db.getFirstAsync<EditableTransaction>(`SELECT t.id, t.type, t.amountMinor, t.date, t.accountId, t.categoryId, a.name AS accountName,
    a.currencyCode, c.name AS categoryName, t.note, t.excludeFromReport
    FROM transactions t JOIN accounts a ON a.id = t.accountId
    LEFT JOIN categories c ON c.id = t.categoryId
    WHERE t.id = ? AND t.type IN ('EXPENSE', 'INCOME')`, [id]);
}

export async function saveTransactionEdit(original: EditableTransaction, note: string, excludeFromReport: boolean) {
  validId(original.id);
  if (original.type !== 'EXPENSE' && original.type !== 'INCOME') throw new Error('Transfers cannot be edited here.');
  const db = await database();
  const result = await db.runAsync(`UPDATE transactions SET note = ?, excludeFromReport = ?
    WHERE id = ? AND type = ? AND amountMinor = ? AND date = ? AND accountId = ?
      AND categoryId IS ? AND note IS ? AND excludeFromReport = ?`,
    [note.trim() || null, Number(excludeFromReport), original.id, original.type,
      original.amountMinor, original.date, original.accountId, original.categoryId, original.note, original.excludeFromReport]);
  if (result.changes !== 1) throw new Error('Transaction was changed or removed. Reload before saving.');
}
