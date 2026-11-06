import { database, epochDay } from '@/lib/database';

export type AccountBalance = { id: number; name: string; currencyCode: string; balanceMinor: number };
export type CategorySpending = { categoryId: number | null; categoryName: string | null; currencyCode: string; amountMinor: number };
export type MonthlySummary = { currencyCode: string; incomeMinor: number; expenseMinor: number };

export async function accountBalances(today = epochDay(new Date())): Promise<AccountBalance[]> {
  const db = await database();
  return db.getAllAsync<AccountBalance>(`SELECT a.id, a.name, a.currencyCode,
    a.openingBalanceMinor + COALESCE(SUM(CASE
      WHEN t.type = 'EXPENSE' THEN -t.amountMinor
      WHEN t.type = 'INCOME' THEN t.amountMinor
      WHEN t.type = 'TRANSFER' AND t.accountId = a.id THEN -t.amountMinor
      WHEN t.type = 'TRANSFER' AND t.transferAccountId = a.id THEN t.amountMinor
      ELSE 0 END), 0) AS balanceMinor
    FROM accounts a LEFT JOIN transactions t ON (t.accountId = a.id OR (t.type = 'TRANSFER' AND t.transferAccountId = a.id)) AND t.date <= ?
    GROUP BY a.id ORDER BY a.name, a.id`, [today]);
}

export async function monthlyReport(year: number, month: number, accountId?: number): Promise<{ spending: CategorySpending[]; summaries: MonthlySummary[] }> {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('Invalid month.');
  if (accountId !== undefined && (!Number.isSafeInteger(accountId) || accountId <= 0)) throw new Error('Invalid account.');
  // setUTCFullYear preserves years 1–99, unlike the multi-argument Date constructor.
  const boundary = new Date(0);
  boundary.setUTCFullYear(year, month - 1, 1);
  const start = boundary.getTime() / 86400000;
  boundary.setUTCFullYear(year, month, 1);
  const end = boundary.getTime() / 86400000;
  const accountFilter = accountId === undefined ? '' : ' AND t.accountId = ?';
  const params = accountId === undefined ? [start, end] : [start, end, accountId];
  const db = await database();
  const [spending, summaries] = await Promise.all([
    db.getAllAsync<CategorySpending>(`SELECT t.categoryId, c.name AS categoryName, a.currencyCode, SUM(t.amountMinor) AS amountMinor
      FROM transactions t JOIN accounts a ON a.id = t.accountId
      LEFT JOIN categories c ON c.id = t.categoryId
      WHERE t.type = 'EXPENSE' AND t.excludeFromReport = 0 AND t.date >= ? AND t.date < ?${accountFilter}
      GROUP BY a.currencyCode, t.categoryId ORDER BY a.currencyCode, amountMinor DESC, categoryName`, params),
    db.getAllAsync<MonthlySummary>(`SELECT a.currencyCode,
      SUM(CASE WHEN t.type = 'INCOME' THEN t.amountMinor ELSE 0 END) AS incomeMinor,
      SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amountMinor ELSE 0 END) AS expenseMinor
      FROM transactions t JOIN accounts a ON a.id = t.accountId
      WHERE t.type IN ('INCOME', 'EXPENSE') AND t.excludeFromReport = 0 AND t.date >= ? AND t.date < ?${accountFilter}
      GROUP BY a.currencyCode ORDER BY a.currencyCode`, params),
  ]);
  return { spending, summaries };
}
