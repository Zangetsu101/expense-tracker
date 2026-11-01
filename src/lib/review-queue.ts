import { database } from './database';

const principalLegs = `SELECT t.id FROM transactions t
  LEFT JOIN categories category ON category.id = t.categoryId
  LEFT JOIN lending_entries entry ON entry.transactionId = t.id
  WHERE (entry.id IS NOT NULL OR (t.source = 'IMPORT' AND
    ((t.type = 'EXPENSE' AND lower(trim(category.name)) IN ('loan', 'repayment')) OR
     (t.type = 'INCOME' AND lower(trim(category.name)) IN ('debt', 'debt collection')))))`;

export type ReviewCandidate = {
  id: number; confidenceNote: string; date: number; amountMinor: number;
  outgoingAccount: string; incomingAccount: string; currencyCode: string;
  outgoingNote: string | null; incomingNote: string | null;
};

export async function listReviewCandidates(): Promise<ReviewCandidate[]> {
  const db = await database();
  return db.getAllAsync<ReviewCandidate>(`SELECT c.id, c.confidenceNote, o.date, o.amountMinor,
    oa.name AS outgoingAccount, ia.name AS incomingAccount, oa.currencyCode,
    o.note AS outgoingNote, i.note AS incomingNote
    FROM transfer_candidates c
    JOIN transactions o ON o.id = c.outgoingTxnId
    JOIN transactions i ON i.id = c.incomingTxnId
    JOIN accounts oa ON oa.id = o.accountId
    JOIN accounts ia ON ia.id = i.accountId
    WHERE c.resolved = 0 AND NOT EXISTS (${principalLegs} AND t.id IN (o.id, i.id))
    ORDER BY o.date DESC, c.id DESC`);
}

export async function rejectCandidate(id: number) {
  const db = await database();
  const result = await db.runAsync('UPDATE transfer_candidates SET resolved = 1 WHERE id = ? AND resolved = 0', [id]);
  if (result.changes !== 1) throw new Error('Candidate is no longer available. Refresh the queue.');
}

export async function confirmCandidate(id: number) {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const pair = await tx.getFirstAsync<{
      outgoingTxnId: number; incomingTxnId: number; outgoingType: string; incomingType: string;
      outgoingDate: number; incomingDate: number; outgoingAmount: number; incomingAmount: number;
      outgoingExcluded: number; incomingExcluded: number; outgoingNote: string | null; incomingNote: string | null;
      outgoingAccountId: number; incomingAccountId: number; outgoingCurrency: string; incomingCurrency: string;
    }>(`SELECT c.outgoingTxnId, c.incomingTxnId, o.type AS outgoingType, i.type AS incomingType,
      o.date AS outgoingDate, i.date AS incomingDate, o.amountMinor AS outgoingAmount, i.amountMinor AS incomingAmount,
      o.excludeFromReport AS outgoingExcluded, i.excludeFromReport AS incomingExcluded,
      o.note AS outgoingNote, i.note AS incomingNote,
      o.accountId AS outgoingAccountId, i.accountId AS incomingAccountId,
      oa.currencyCode AS outgoingCurrency, ia.currencyCode AS incomingCurrency
      FROM transfer_candidates c
      JOIN transactions o ON o.id = c.outgoingTxnId
      JOIN transactions i ON i.id = c.incomingTxnId
      JOIN accounts oa ON oa.id = o.accountId
      JOIN accounts ia ON ia.id = i.accountId
      WHERE c.id = ? AND c.resolved = 0`, [id]);
    if (!pair) throw new Error('Candidate is no longer available. Refresh the queue.');
    if (pair.outgoingType !== 'EXPENSE' || pair.incomingType !== 'INCOME' ||
      pair.outgoingDate !== pair.incomingDate || pair.outgoingAmount !== pair.incomingAmount ||
      pair.outgoingCurrency !== pair.incomingCurrency || pair.outgoingAccountId === pair.incomingAccountId ||
      pair.outgoingTxnId === pair.incomingTxnId) {
      throw new Error('The two transactions no longer form a valid same-currency transfer.');
    }
    const principal = await tx.getFirstAsync(`${principalLegs} AND t.id IN (?, ?) LIMIT 1`, [pair.outgoingTxnId, pair.incomingTxnId]);
    if (principal) throw new Error('Lending principal cannot be confirmed as a Transfer.');
    const details = await tx.getFirstAsync<{ count: number }>(`SELECT
      (SELECT COUNT(*) FROM line_items WHERE transactionId IN (?, ?)) +
      (SELECT COUNT(*) FROM transaction_tags WHERE transactionId IN (?, ?)) AS count`,
      [pair.outgoingTxnId, pair.incomingTxnId, pair.outgoingTxnId, pair.incomingTxnId]);
    if (details?.count) throw new Error('These Transactions have Line Items or tags. Remove them before confirming the Transfer.');
    await tx.runAsync('UPDATE moneylover_import_rows SET transactionId = ? WHERE transactionId = ?', [pair.outgoingTxnId, pair.incomingTxnId]);
    await tx.runAsync('DELETE FROM transfer_candidates WHERE outgoingTxnId = ? OR incomingTxnId = ?',
      [pair.incomingTxnId, pair.incomingTxnId]);
    await tx.runAsync('UPDATE transfer_candidates SET resolved = 1 WHERE outgoingTxnId = ? OR incomingTxnId = ?',
      [pair.outgoingTxnId, pair.outgoingTxnId]);
    const notes = [pair.outgoingNote, pair.incomingNote].filter((note, index, values) => note && values.indexOf(note) === index);
    await tx.runAsync(`UPDATE transactions SET type = 'TRANSFER', transferAccountId = ?, categoryId = NULL,
      note = ?, excludeFromReport = ? WHERE id = ?`, [pair.incomingAccountId, notes.join('\n') || null,
        Number(Boolean(pair.outgoingExcluded || pair.incomingExcluded)), pair.outgoingTxnId]);
    await tx.runAsync('DELETE FROM transactions WHERE id = ?', [pair.incomingTxnId]);
  });
}
