import { database, epochDay } from '@/lib/database';
import type { MonthlySummary } from '@/lib/reports';
import type { TransactionRow } from '@/lib/database';
import type { LendingLabel } from './transaction-format';

export type HomeTransaction = TransactionRow & LendingLabel & { currencyCode: string; transferAccountName: string | null };

export type DailySummary = MonthlySummary & { date: number };

export async function homeData(now = new Date()): Promise<{ rows: HomeTransaction[]; summaries: MonthlySummary[]; dailySummaries: DailySummary[] }> {
  const db = await database();
  const start = epochDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const end = epochDay(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const [rows, summaries] = await Promise.all([
    db.getAllAsync<HomeTransaction>(`SELECT t.id, t.type, t.amountMinor, t.date, a.name AS accountName,
      a.currencyCode, c.name AS categoryName, t.note, destination.name AS transferAccountName,
      lending.kind AS lendingKind, person.name AS personName
      FROM transactions t JOIN accounts a ON a.id = t.accountId
      LEFT JOIN accounts destination ON destination.id = t.transferAccountId
      LEFT JOIN categories c ON c.id = t.categoryId
      LEFT JOIN lending_entries lending ON lending.transactionId = t.id
      LEFT JOIN people person ON person.id = lending.personId
      ORDER BY t.date DESC, t.id DESC LIMIT 50`),
    db.getAllAsync<MonthlySummary>(`SELECT a.currencyCode,
      SUM(CASE WHEN t.type = 'INCOME' THEN t.amountMinor ELSE 0 END) AS incomeMinor,
      SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amountMinor ELSE 0 END) AS expenseMinor
      FROM transactions t JOIN accounts a ON a.id = t.accountId
      WHERE t.type IN ('INCOME', 'EXPENSE') AND t.excludeFromReport = 0 AND t.date >= ? AND t.date < ?
      GROUP BY a.currencyCode ORDER BY a.currencyCode`, [start, end]),
  ]);
  const dates = [...new Set(rows.map((row) => row.date))];
  const dailySummaries = dates.length === 0 ? [] : await db.getAllAsync<DailySummary>(`SELECT t.date, a.currencyCode,
    SUM(CASE WHEN t.type = 'INCOME' THEN t.amountMinor ELSE 0 END) AS incomeMinor,
    SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amountMinor ELSE 0 END) AS expenseMinor
    FROM transactions t JOIN accounts a ON a.id = t.accountId
    WHERE t.date IN (${dates.map(() => '?').join(',')})
    GROUP BY t.date, a.currencyCode ORDER BY t.date DESC, a.currencyCode`, dates);
  return { rows, summaries, dailySummaries };
}
