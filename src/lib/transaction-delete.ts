import { database } from './database';
import { deleteLendingEntry, type LendingResult } from './lending';

/**
 * Delete one Transaction with its tags, Line Items and import identity.
 * A Transaction linked to a lending entry goes through the lending rules,
 * so a deletion that creates overpaid credit needs confirmation.
 */
export async function deleteTransaction(
  id: number,
  options: { confirmOverpayment?: boolean } = {},
): Promise<LendingResult> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid transaction ID.');
  const db = await database();
  const lending = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM lending_entries WHERE transactionId = ?',
    [id],
  );
  if (lending)
    return deleteLendingEntry(lending.id, {
      confirmDelete: true,
      confirmOverpayment: options.confirmOverpayment,
    });
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (await tx.getFirstAsync('SELECT 1 FROM lending_entries WHERE transactionId = ?', [id]))
      throw new Error('Transaction was changed. Reload before deleting.');
    await tx.runAsync(
      'DELETE FROM transfer_candidates WHERE outgoingTxnId = ? OR incomingTxnId = ?',
      [id, id],
    );
    const result = await tx.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
    if (result.changes !== 1) throw new Error('Transaction was already removed.');
  });
  return { status: 'deleted' };
}
