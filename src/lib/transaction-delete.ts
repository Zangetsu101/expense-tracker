import { notifyDataChanged } from './data-changes.ts';
import { database } from './database';
import { deleteLendingEntry, type LendingResult } from './lending';

/**
 * Delete one Transaction with its legs, tags and Line Items.
 * A lending Transaction or a Write-off goes through the lending rules,
 * so a deletion that creates overpaid credit needs confirmation.
 */
export async function deleteTransaction(
  id: number,
  options: { confirmOverpayment?: boolean } = {},
): Promise<LendingResult> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid transaction ID.');
  const db = await database();
  const lending = "SELECT 1 FROM transactions WHERE id = ? AND kind IN ('LENDING', 'WRITE_OFF')";
  if (await db.getFirstAsync(lending, [id]))
    return deleteLendingEntry(id, {
      confirmDelete: true,
      confirmOverpayment: options.confirmOverpayment,
    });
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (await tx.getFirstAsync(lending, [id]))
      throw new Error('Transaction was changed. Reload before deleting.');
    if (await tx.getFirstAsync('SELECT 1 FROM reimbursements WHERE expenseId = ?', [id]))
      throw new Error('This expense has linked reimbursements. Delete them first.');
    const result = await tx.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
    if (result.changes !== 1) throw new Error('Transaction was already removed.');
  });
  notifyDataChanged();
  return { status: 'deleted' };
}
