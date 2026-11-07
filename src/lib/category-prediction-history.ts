import { database } from './database';
import type { CategoryEvidence } from './category-prediction';

export async function listCategoryEvidence(type: 'EXPENSE' | 'INCOME', currency: string) {
  return (await database()).getAllAsync<CategoryEvidence>(
    `SELECT t.categoryId, t.accountId, t.amountMinor, t.date AS day
     FROM transactions t
     JOIN accounts a ON a.id = t.accountId
     JOIN categories c ON c.id = t.categoryId
     WHERE t.type = ? AND c.type = t.type AND a.currencyCode = ?
       AND c.needsReview = 0
       AND NOT EXISTS (SELECT 1 FROM lending_entries l WHERE l.transactionId = t.id)
       AND NOT (t.source = 'IMPORT' AND
         ((t.type = 'EXPENSE' AND lower(c.name) IN ('loan', 'repayment')) OR
          (t.type = 'INCOME' AND lower(c.name) IN ('debt', 'debt collection'))))`,
    [type, currency],
  );
}
