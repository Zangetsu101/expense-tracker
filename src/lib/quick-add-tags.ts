import { notifyDataChanged } from './data-changes.ts';
import { database, epochDay } from './database';
import type { SplitShare } from './reimbursements.ts';
import { addTransactionTags, parseQuickAddTags } from './tag-store';
import { insertTransaction } from './ledger-store.ts';
export { MAX_QUICK_ADD_TAGS, parseQuickAddTags } from './tag-store';

type QuickAddInput = {
  type: 'EXPENSE' | 'INCOME';
  amountMinor: number;
  accountId: number;
  categoryId: number | null;
  shares?: SplitShare[];
  reimbursement?: { expenseId: number; personId: number | null };
  date: Date;
  note: string | null;
};

export async function addQuickTransaction(input: QuickAddInput, tagText: string) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new Error('Enter a positive amount.');
  const date = epochDay(input.date);
  if (date > epochDay(new Date()) || !Number.isFinite(input.date.getTime()))
    throw new Error('Choose today or a past date.');
  const tags = tagText.trim() ? parseQuickAddTags(tagText) : [];
  const db = await database();
  let id = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (input.shares?.length && input.type !== 'EXPENSE')
      throw new Error('Only an expense can be split.');
    if (input.reimbursement) {
      const { expenseId, personId } = input.reimbursement;
      const expense = await tx.getFirstAsync<{ date: number }>(
        `SELECT e.date FROM transactions e
         JOIN legs original ON original.transactionId = e.id AND original.accountId IS NOT NULL
         JOIN accounts destination ON destination.id = ?
         WHERE e.id = ? AND e.kind = 'EXPENSE' AND original.currencyCode = destination.currencyCode`,
        [input.accountId, expenseId],
      );
      if (input.type !== 'INCOME' || !expense)
        throw new Error('Choose an expense in the same currency as the destination account.');
      if (date < expense.date)
        throw new Error('Choose a reimbursement date on or after the expense.');
      if (
        personId !== null &&
        !(await tx.getFirstAsync(
          'SELECT 1 FROM split_shares WHERE expenseId = ? AND personId = ?',
          [expenseId, personId],
        ))
      )
        throw new Error('Choose a person from the expense split.');
    }
    const common = { date, note: input.note, accountId: input.accountId };
    id = await insertTransaction(
      tx,
      input.reimbursement
        ? {
            ...common,
            kind: 'REIMBURSEMENT',
            amountMinor: input.amountMinor,
            excludeFromReport: false,
            ...input.reimbursement,
          }
        : {
            ...common,
            kind: input.type,
            amountMinor: input.amountMinor,
            categoryId: input.categoryId,
            excludeFromReport: false,
          },
    );
    for (const share of input.shares ?? []) {
      if (!Number.isSafeInteger(share.amountMinor) || share.amountMinor < 0)
        throw new Error('Enter a valid share amount.');
      const result = await tx.runAsync(
        'INSERT INTO split_shares (expenseId, personId, amountMinor) SELECT ?, id, ? FROM people WHERE id = ?',
        [id, share.amountMinor, share.personId],
      );
      if (result.changes !== 1) throw new Error('A person in the split could not be found.');
    }
    if (input.reimbursement) {
      await tx.runAsync(
        'INSERT INTO reimbursements (transactionId, expenseId, personId) VALUES (?, ?, ?)',
        [id, input.reimbursement.expenseId, input.reimbursement.personId],
      );
    }
    await addTransactionTags(tx, id, tags);
  });
  notifyDataChanged({ id, date, accountIds: [input.accountId] });
}
