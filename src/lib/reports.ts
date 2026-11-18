import { database, epochDay } from '@/lib/database';
import { periodsBack, type PeriodKind } from './usual-spending.ts';

export type AccountBalance = {
  id: number;
  name: string;
  currencyCode: string;
  balanceMinor: number;
};
export type CategorySpending = {
  categoryId: number | null;
  categoryName: string | null;
  /** The Category at the top of the tree. It is the Category itself when it has no parent. */
  topId: number | null;
  topName: string | null;
  currencyCode: string;
  amountMinor: number;
};
/** Reportable Expenses on one day, in one Currency and one Category. */
export type SpendRow = {
  currencyCode: string;
  categoryId: number | null;
  categoryName: string | null;
  /** The Category at the top of the tree, or null when the Expense has no Category. */
  topId: number | null;
  topName: string | null;
  date: number;
  amountMinor: number;
};
export type MonthlySummary = { currencyCode: string; incomeMinor: number; expenseMinor: number };

export async function accountBalances(today = epochDay(new Date())): Promise<AccountBalance[]> {
  const db = await database();
  return db.getAllAsync<AccountBalance>(
    `SELECT a.id, a.name, a.currencyCode,
    a.openingBalanceMinor + COALESCE(SUM(CASE
      WHEN t.type = 'EXPENSE' THEN -t.amountMinor
      WHEN t.type = 'INCOME' THEN t.amountMinor
      WHEN t.type = 'TRANSFER' AND t.accountId = a.id THEN -t.amountMinor
      WHEN t.type = 'TRANSFER' AND t.transferAccountId = a.id THEN COALESCE(t.receivedAmountMinor, t.amountMinor)
      ELSE 0 END), 0) AS balanceMinor
    FROM accounts a LEFT JOIN transactions t ON (t.accountId = a.id OR (t.type = 'TRANSFER' AND t.transferAccountId = a.id)) AND t.date <= ?
    GROUP BY a.id ORDER BY a.name, a.id`,
    [today],
  );
}

/** Each Category with the Category at the top of its tree. A Category in a loop has no top. */
const categoryTops = `WITH RECURSIVE tops(id, topId) AS (
  SELECT id, id FROM categories WHERE parentId IS NULL
  UNION ALL SELECT c.id, tops.topId FROM categories c JOIN tops ON c.parentId = tops.id)`;

/** Income, Expense and spending by Category for the local days from `start` to `end` (exclusive). */
export async function rangeReport(
  start: number,
  end: number,
  accountId?: number,
): Promise<{ spending: CategorySpending[]; summaries: MonthlySummary[] }> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end)
    throw new Error('Invalid range.');
  if (accountId !== undefined && (!Number.isSafeInteger(accountId) || accountId <= 0))
    throw new Error('Invalid account.');
  const accountFilter = accountId === undefined ? '' : ' AND t.accountId = ?';
  const params = accountId === undefined ? [start, end] : [start, end, accountId];
  const db = await database();
  const [spending, summaries] = await Promise.all([
    db.getAllAsync<CategorySpending>(
      `${categoryTops}
      SELECT t.categoryId, c.name AS categoryName, COALESCE(tops.topId, t.categoryId) AS topId,
      COALESCE(top.name, c.name) AS topName, a.currencyCode, SUM(t.amountMinor) AS amountMinor
      FROM transactions t JOIN accounts a ON a.id = t.accountId
      LEFT JOIN categories c ON c.id = t.categoryId
      LEFT JOIN tops ON tops.id = t.categoryId
      LEFT JOIN categories top ON top.id = tops.topId
      WHERE t.type = 'EXPENSE' AND t.excludeFromReport = 0 AND t.date >= ? AND t.date < ?${accountFilter}
      GROUP BY a.currencyCode, t.categoryId ORDER BY a.currencyCode, amountMinor DESC, categoryName`,
      params,
    ),
    db.getAllAsync<MonthlySummary>(
      `SELECT a.currencyCode,
      SUM(CASE WHEN t.type = 'INCOME' THEN t.amountMinor ELSE 0 END) AS incomeMinor,
      SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amountMinor ELSE 0 END) AS expenseMinor
      FROM transactions t JOIN accounts a ON a.id = t.accountId
      WHERE t.type IN ('INCOME', 'EXPENSE') AND t.excludeFromReport = 0 AND t.date >= ? AND t.date < ?${accountFilter}
      GROUP BY a.currencyCode ORDER BY a.currencyCode`,
      params,
    ),
  ]);
  return { spending, summaries };
}

/** Reportable Expenses for each day, Currency and Category from `start` to `end` (exclusive). */
export async function spendDays(
  accountId: number | null,
  start: number,
  end: number,
): Promise<SpendRow[]> {
  const db = await database();
  return db.getAllAsync<SpendRow>(
    `${categoryTops}
    SELECT a.currencyCode, t.categoryId, c.name AS categoryName,
    COALESCE(tops.topId, t.categoryId) AS topId, COALESCE(top.name, c.name) AS topName,
    t.date, SUM(t.amountMinor) AS amountMinor
    FROM transactions t JOIN accounts a ON a.id = t.accountId
    LEFT JOIN categories c ON c.id = t.categoryId
    LEFT JOIN tops ON tops.id = t.categoryId
    LEFT JOIN categories top ON top.id = tops.topId
    WHERE t.type = 'EXPENSE' AND t.excludeFromReport = 0 AND t.date >= ? AND t.date < ?
    ${accountId === null ? '' : 'AND t.accountId = ?'}
    GROUP BY a.currencyCode, t.categoryId, t.date`,
    accountId === null ? [start, end] : [start, end, accountId],
  );
}

/** Daily spending for the period that has `today` and `back` periods before it, with those periods. */
export async function spendHistory(
  accountId: number | null,
  kind: PeriodKind,
  monthStart: number,
  today: number,
  back: number,
) {
  const periods = periodsBack(kind, today, monthStart, back);
  return { periods, rows: await spendDays(accountId, periods.at(-1)!.start, periods[0].end) };
}
