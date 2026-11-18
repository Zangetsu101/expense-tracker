import { database } from '@/lib/database';
import { getDisplayRate } from '@/lib/display-rate-store';
import { firstTransferRate, type LastTransferRate } from '@/lib/transfer-amounts';

export async function loadFirstTransferRate(source: string, destination: string) {
  const db = await database();
  const [display, last] = await Promise.all([
    getDisplayRate(),
    db.getFirstAsync<LastTransferRate>(
      `SELECT t.amountMinor AS paid, t.receivedAmountMinor AS received,
      a.currencyCode AS source, b.currencyCode AS destination, t.date
      FROM transactions t JOIN accounts a ON a.id = t.accountId JOIN accounts b ON b.id = t.transferAccountId
      WHERE t.type = 'TRANSFER' AND t.receivedAmountMinor IS NOT NULL AND
      ((a.currencyCode = ? AND b.currencyCode = ?) OR (a.currencyCode = ? AND b.currencyCode = ?))
      ORDER BY t.date DESC, t.id DESC LIMIT 1`,
      [source, destination, destination, source],
    ),
  ]);
  return firstTransferRate(source, destination, display, last);
}
