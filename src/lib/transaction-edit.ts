import { database } from './database';
import { parseQuickAddTags } from './quick-add-tags';

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
  tags: { id: number; name: string }[];
};

function validId(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid transaction ID.');
}

export async function loadEditableTransaction(id: number): Promise<EditableTransaction | null> {
  validId(id);
  const db = await database();
  const row = await db.getFirstAsync<Omit<EditableTransaction, 'tags'>>(`SELECT t.id, t.type, t.amountMinor, t.date, t.accountId, t.categoryId, a.name AS accountName,
    a.currencyCode, c.name AS categoryName, t.note, t.excludeFromReport
    FROM transactions t JOIN accounts a ON a.id = t.accountId
    LEFT JOIN categories c ON c.id = t.categoryId
    WHERE t.id = ? AND t.type IN ('EXPENSE', 'INCOME')`, [id]);
  if (!row) return null;
  const tags = await db.getAllAsync<{ id: number; name: string }>(`SELECT tags.id, tags.name FROM tags
    JOIN transaction_tags tt ON tt.tagId = tags.id WHERE tt.transactionId = ? ORDER BY tags.id`, [id]);
  return { ...row, tags };
}

export async function saveTransactionEdit(original: EditableTransaction, note: string, excludeFromReport: boolean, tagText: string) {
  validId(original.id);
  if (original.type !== 'EXPENSE' && original.type !== 'INCOME') throw new Error('Transfers cannot be edited here.');
  const names = tagText.trim() ? parseQuickAddTags(tagText) : [];
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await tx.getAllAsync<{ id: number; name: string }>(`SELECT tags.id, tags.name FROM tags
      JOIN transaction_tags tt ON tt.tagId = tags.id WHERE tt.transactionId = ? ORDER BY tags.id`, [original.id]);
    if (JSON.stringify(current) !== JSON.stringify(original.tags)) throw new Error('Transaction was changed or removed. Reload before saving.');
    const result = await tx.runAsync(`UPDATE transactions SET note = ?, excludeFromReport = ?
      WHERE id = ? AND type = ? AND amountMinor = ? AND date = ? AND accountId = ?
        AND categoryId IS ? AND note IS ? AND excludeFromReport = ?`,
      [note.trim() || null, Number(excludeFromReport), original.id, original.type,
        original.amountMinor, original.date, original.accountId, original.categoryId, original.note, original.excludeFromReport]);
    if (result.changes !== 1) throw new Error('Transaction was changed or removed. Reload before saving.');
    const ids: number[] = [];
    for (const name of names) {
      const existing = await tx.getFirstAsync<{ id: number }>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1', [name]);
      ids.push(existing?.id ?? (await tx.runAsync('INSERT INTO tags (name) VALUES (?)', [name])).lastInsertRowId);
    }
    await tx.runAsync('DELETE FROM transaction_tags WHERE transactionId = ?', [original.id]);
    for (const tagId of ids) await tx.runAsync('INSERT INTO transaction_tags (transactionId, tagId) VALUES (?, ?)', [original.id, tagId]);
  });
}
