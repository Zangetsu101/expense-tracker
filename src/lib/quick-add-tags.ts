import { notifyDataChanged } from './data-changes.ts';
import { database, epochDay } from './database';
import { addTransactionTags, parseQuickAddTags } from './tag-store';
export { MAX_QUICK_ADD_TAGS, parseQuickAddTags } from './tag-store';

type QuickAddInput = {
  type: 'EXPENSE' | 'INCOME';
  amountMinor: number;
  accountId: number;
  categoryId: number;
  date: Date;
  note: string | null;
};

export async function addQuickTransaction(input: QuickAddInput, tagText: string) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new Error('Enter a positive amount.');
  if (epochDay(input.date) > epochDay(new Date()) || !Number.isFinite(input.date.getTime()))
    throw new Error('Choose today or a past date.');
  const tags = tagText.trim() ? parseQuickAddTags(tagText) : [];
  const db = await database();
  let id = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      'INSERT INTO transactions (type, amountMinor, date, accountId, categoryId, note) VALUES (?, ?, ?, ?, ?, ?)',
      [
        input.type,
        input.amountMinor,
        epochDay(input.date),
        input.accountId,
        input.categoryId,
        input.note,
      ],
    );
    id = result.lastInsertRowId;
    await addTransactionTags(tx, id, tags);
  });
  notifyDataChanged({ id, date: epochDay(input.date), accountIds: [input.accountId] });
}
