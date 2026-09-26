import { database, epochDay } from './database';
import { findOrCreateTag } from './tag-store';

type QuickAddInput = {
  type: 'EXPENSE' | 'INCOME'; amountMinor: number; accountId: number; categoryId: number; note: string | null;
};

export const MAX_QUICK_ADD_TAGS = 20;

export function parseQuickAddTags(text: string): string[] {
  const parts = text.split(',');
  if (parts.length > MAX_QUICK_ADD_TAGS) throw new Error(`Use at most ${MAX_QUICK_ADD_TAGS} tags.`);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const name = part.trim();
    if (!name) throw new Error('Remove empty tags.');
    const key = name.toLowerCase();
    if (!seen.has(key)) { names.push(name); seen.add(key); }
  }
  return names;
}

export async function addQuickTransaction(input: QuickAddInput, tagText: string) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('Enter a positive amount.');
  const tags = tagText.trim() ? parseQuickAddTags(tagText) : [];
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync('INSERT INTO transactions (type, amountMinor, date, accountId, categoryId, note) VALUES (?, ?, ?, ?, ?, ?)',
      [input.type, input.amountMinor, epochDay(new Date()), input.accountId, input.categoryId, input.note]);
    for (const name of tags) {
      const tagId = await findOrCreateTag(tx, name);
      await tx.runAsync('INSERT INTO transaction_tags (transactionId, tagId) VALUES (?, ?)', [result.lastInsertRowId, tagId]);
    }
  });
}
