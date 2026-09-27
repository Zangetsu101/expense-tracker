import { database, epochDay } from '@/lib/database';
import type { MonthlySummary } from '@/lib/reports';
import type { TransactionRow } from '@/lib/database';

export type HomeTransaction = TransactionRow & { currencyCode: string; transferAccountName: string | null };

export async function homeData(now = new Date()): Promise<{ rows: HomeTransaction[]; summaries: MonthlySummary[] }> {
  const db = await database();
  const start = epochDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const end = epochDay(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const [rows, summaries] = await Promise.all([
    db.getAllAsync<HomeTransaction>(`SELECT t.id, t.type, t.amountMinor, t.date, a.name AS accountName,
      a.currencyCode, c.name AS categoryName, t.note, destination.name AS transferAccountName
      FROM transactions t JOIN accounts a ON a.id = t.accountId
      LEFT JOIN accounts destination ON destination.id = t.transferAccountId
      LEFT JOIN categories c ON c.id = t.categoryId
      ORDER BY t.date DESC, t.id DESC LIMIT 50`),
    db.getAllAsync<MonthlySummary>(`SELECT a.currencyCode,
      SUM(CASE WHEN t.type = 'INCOME' THEN t.amountMinor ELSE 0 END) AS incomeMinor,
      SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amountMinor ELSE 0 END) AS expenseMinor
      FROM transactions t JOIN accounts a ON a.id = t.accountId
      WHERE t.type IN ('INCOME', 'EXPENSE') AND t.excludeFromReport = 0 AND t.date >= ? AND t.date < ?
      GROUP BY a.currencyCode ORDER BY a.currencyCode`, [start, end]),
  ]);
  return { rows, summaries };
}
