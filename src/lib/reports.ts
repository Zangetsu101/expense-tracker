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
/** Net spending on one day, in one Currency and one Category. */
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
export type MonthlySummary = {
  investedMinor?: number;
  currencyCode: string;
  incomeMinor: number;
  expenseMinor: number;
};

/** Balance of account a through the date bound to this expression. */
export const balanceAsOfSql = `a.openingBalanceMinor + COALESCE((
  SELECT SUM(l.amountMinor) FROM legs l JOIN transactions t ON t.id = l.transactionId
  WHERE l.accountId = a.id AND t.date <= ?), 0)`;

export async function accountBalances(today = epochDay(new Date())): Promise<AccountBalance[]> {
  const db = await database();
  return db.getAllAsync<AccountBalance>(
    `SELECT a.id, a.name, a.currencyCode, ${balanceAsOfSql} AS balanceMinor
    FROM accounts a ORDER BY a.name, a.id`,
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
  const amount =
    accountId === undefined
      ? 'l.amountMinor'
      : 'CASE WHEN l.amountMinor > 0 THEN abs(scoped.amountMinor) ELSE -abs(scoped.amountMinor) END';
  const currency = accountId === undefined ? 'l.currencyCode' : 'scoped.currencyCode';
  const [spending, summaries, capital] = await Promise.all([
    db.getAllAsync<CategorySpending>(
      `${categoryTops}
      SELECT t.categoryId, c.name AS categoryName, COALESCE(tops.topId, t.categoryId) AS topId,
      COALESCE(top.name, c.name) AS topName, a.currencyCode, SUM(t.spendingMinor) AS amountMinor
      FROM report_transactions t JOIN accounts a ON a.id = t.accountId
      LEFT JOIN categories c ON c.id = t.categoryId
      LEFT JOIN tops ON tops.id = c.id
      LEFT JOIN categories top ON top.id = tops.topId
      WHERE t.spendingMinor IS NOT NULL AND t.date >= ? AND t.date < ?${accountFilter}
      GROUP BY a.currencyCode, t.categoryId ORDER BY a.currencyCode, amountMinor DESC, categoryName`,
      params,
    ),
    db.getAllAsync<MonthlySummary>(
      `SELECT a.currencyCode,
      SUM(t.incomeMinor) AS incomeMinor,
      COALESCE(SUM(t.spendingMinor), 0) AS expenseMinor
      FROM report_transactions t JOIN accounts a ON a.id = t.accountId
      WHERE t.date >= ? AND t.date < ?${accountFilter}
      GROUP BY a.currencyCode ORDER BY a.currencyCode`,
      params,
    ),
    db.getAllAsync<{ currencyCode: string; investedMinor: number }>(
      `SELECT ${currency} AS currencyCode, SUM(${amount}) AS investedMinor
      FROM investments i JOIN legs l ON l.accountId = i.accountId
      JOIN transactions t ON t.id = l.transactionId AND t.kind = 'TRANSFER'
      JOIN legs other ON other.transactionId = t.id AND other.id <> l.id
      ${accountId === undefined ? '' : 'JOIN legs scoped ON scoped.transactionId = t.id AND scoped.accountId = ?'}
      WHERE t.date >= ? AND t.date < ?
        AND other.accountId NOT IN (SELECT accountId FROM investments)
      GROUP BY 1 HAVING investedMinor <> 0`,
      accountId === undefined ? [start, end] : [accountId, start, end],
    ),
  ]);
  for (const { currencyCode, investedMinor } of capital) {
    const summary = summaries.find((row) => row.currencyCode === currencyCode);
    if (summary) summary.investedMinor = investedMinor;
    else summaries.push({ currencyCode, incomeMinor: 0, expenseMinor: 0, investedMinor });
  }
  return { spending, summaries };
}

/** Net spending for each day, Currency and Category from `start` to `end` (exclusive). */
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
    t.date, SUM(t.spendingMinor) AS amountMinor
    FROM report_transactions t JOIN accounts a ON a.id = t.accountId
      LEFT JOIN categories c ON c.id = t.categoryId
    LEFT JOIN tops ON tops.id = c.id
    LEFT JOIN categories top ON top.id = tops.topId
    WHERE t.spendingMinor IS NOT NULL AND t.date >= ? AND t.date < ?
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
