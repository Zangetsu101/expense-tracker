import { database } from './database';
import type { CategoryEvidence } from './category-prediction';

export async function listCategoryEvidence(type: 'EXPENSE' | 'INCOME', currency: string) {
  return (await database()).getAllAsync<CategoryEvidence>(
    `SELECT t.categoryId, l.accountId, abs(l.amountMinor) AS amountMinor, t.date AS day
     FROM transactions t
     JOIN legs l ON l.transactionId = t.id AND l.accountId IS NOT NULL
     JOIN categories c ON c.id = t.categoryId
     WHERE t.kind = ? AND c.type = t.kind AND l.currencyCode = ?`,
    [type, currency],
  );
}
