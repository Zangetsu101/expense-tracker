import { creditCardBills } from '@/lib/credit-cards';
import { database, isFavoriteSql } from '@/lib/database';
import { accountTransactions } from '@/lib/ledger-store';
import type { DisplayRate } from '@/lib/display-rate';
import { getDisplayRate } from '@/lib/display-rate-store';
import type { DeckAccount } from './deck.ts';
import type { PaceRow } from './pace.ts';
import { parsePeriodSetting, type HomePeriod, type PeriodSetting } from './period.ts';
import { periodBack, type ListPeriod, type ListRow, type PeriodRows } from './list.ts';

const readRows = (
  extraColumn = '',
) => `SELECT ${extraColumn}t.id, t.type, t.amountMinor, t.receivedAmountMinor, destination.currencyCode AS destinationCurrencyCode, t.date, t.accountId, t.transferAccountId,
  a.name AS accountName, destination.name AS transferAccountName, a.currencyCode,
  c.name AS categoryName, parent.name AS parentCategoryName,
  COALESCE(NULLIF(c.iconKey, ''), NULLIF(parent.iconKey, '')) AS categoryEmoji,
  t.note, t.excludeFromReport, t.lendingKind, person.name AS personName,
  r.expenseId AS reimbursementExpenseId, payer.name AS reimbursementPerson,
  expense.date AS reimbursementExpenseDate, expenseCategory.name AS reimbursementCategory,
  (SELECT SUM(s.leftMinor) FROM split_share_progress s WHERE s.expenseId = t.id) AS owedMinor
  FROM ${accountTransactions} t JOIN accounts a ON a.id = t.accountId
  LEFT JOIN accounts destination ON destination.id = t.transferAccountId
  LEFT JOIN categories c ON c.id = t.categoryId
  LEFT JOIN categories parent ON parent.id = c.parentId
  LEFT JOIN people person ON person.id = t.personId
  LEFT JOIN reimbursements r ON r.transactionId = t.id
  LEFT JOIN people payer ON payer.id = r.personId
  LEFT JOIN transactions expense ON expense.id = r.expenseId
  LEFT JOIN categories expenseCategory ON expenseCategory.id = expense.categoryId`;
const listRead = readRows();
type ActivityRecord = Omit<ListRow, 'reimbursement'> & {
  reimbursementExpenseId: number | null;
  reimbursementExpenseDate: number | null;
  reimbursementPerson: string | null;
  reimbursementCategory: string | null;
};

function activityRow({
  reimbursementExpenseId: expenseId,
  reimbursementExpenseDate: expenseDate,
  reimbursementPerson: personName,
  reimbursementCategory: categoryName,
  ...row
}: ActivityRecord): ListRow {
  return expenseId !== null && expenseDate !== null
    ? { ...row, reimbursement: { expenseId, expenseDate, personName, categoryName } }
    : row;
}
const listOrder = 'ORDER BY t.date DESC, t.id DESC';
const scopeFilter = (accountId: number | null) =>
  accountId === null
    ? { sql: '1', params: [] }
    : { sql: '(t.accountId = ? OR t.transferAccountId = ?)', params: [accountId, accountId] };

export type HomeListPage = {
  periods: PeriodRows[];
  /** The date of the oldest Transaction in scope, or `null` when the scope has none. */
  firstDay: number | null;
  /** The steps back to the next older period, or `null` when no older Transactions exist. */
  next: number | null;
};

/**
 * Reads the period `steps` back from the range of the cards. When the range of
 * the cards has no Transactions but older ones exist, the page also has the period before it.
 */
export async function homeListPage(
  accountId: number | null,
  setting: PeriodSetting,
  today: number,
  steps: number,
): Promise<HomeListPage> {
  const db = await database();
  const scope = scopeFilter(accountId);
  const first = await db.getFirstAsync<{ firstDay: number | null }>(
    `SELECT MIN(t.date) AS firstDay FROM ${accountTransactions} t WHERE ${scope.sql}`,
    scope.params,
  );
  const firstDay = first?.firstDay ?? null;
  const olderExists = (period: ListPeriod) => firstDay !== null && firstDay < period.start;
  const periods: PeriodRows[] = [];
  for (let step = steps; ; step++) {
    const period = periodBack(setting, today, step);
    const rows = await db.getAllAsync<ActivityRecord>(
      `${listRead} WHERE ${scope.sql} AND t.date >= ? AND t.date < ? ${listOrder}`,
      [...scope.params, period.start, period.end],
    );
    periods.push({ period, rows: rows.map(activityRow) });
    if (step > 0 || rows.length || !olderExists(period)) break;
  }
  const last = periods.at(-1)!;
  return { periods, firstDay, next: olderExists(last.period) ? steps + periods.length : null };
}

/** Transactions in scope on any date that match the search. LIKE ignores case only for ASCII letters. */
export async function homeSearch(accountId: number | null, query: string): Promise<ListRow[]> {
  const db = await database();
  const scope = scopeFilter(accountId);
  const like = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`;
  const fields = [
    't.note',
    'c.name',
    'parent.name',
    'a.name',
    'destination.name',
    'person.name',
    'payer.name',
    'expenseCategory.name',
  ];
  const rows = await db.getAllAsync<ActivityRecord>(
    `${listRead} WHERE ${scope.sql} AND (${fields.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(' OR ')}) ${listOrder}`,
    [...scope.params, ...fields.map(() => like)],
  );
  return rows.map(activityRow);
}

const fullCategoryPath = `(WITH RECURSIVE path(id, parentId, label, seen) AS (
  SELECT c.id, c.parentId, c.name, ',' || c.id || ','
  UNION ALL SELECT p.id, p.parentId, p.name || ' › ' || path.label, path.seen || p.id || ','
  FROM categories p JOIN path ON path.parentId = p.id
  WHERE instr(path.seen, ',' || p.id || ',') = 0
) SELECT label FROM path WHERE parentId IS NULL) AS categoryPath`;

export async function expensesForReimbursement() {
  const rows = await (
    await database()
  ).getAllAsync<ActivityRecord>(
    `${readRows(fullCategoryPath + ', ')} WHERE t.kind = 'EXPENSE' ${listOrder}`,
  );
  return rows.map(activityRow);
}

export type ShareProgress = {
  personId: number;
  name: string;
  amountMinor: number;
  paidMinor: number;
  leftMinor: number;
};

export async function expenseReimbursements(expenseId: number) {
  const db = await database();
  const [shares, payments] = await Promise.all([
    db.getAllAsync<ShareProgress>(
      `SELECT s.personId, s.amountMinor, s.paidMinor, s.leftMinor, p.name
       FROM split_share_progress s
       JOIN people p ON p.id = s.personId WHERE s.expenseId = ? ORDER BY p.name, p.id`,
      [expenseId],
    ),
    db.getAllAsync<ActivityRecord>(`${listRead} WHERE r.expenseId = ? ${listOrder}`, [expenseId]),
  ]);
  return { shares, payments: payments.map(activityRow) };
}

export async function reimbursementReceipt(id: number, type: 'EXPENSE' | 'INCOME') {
  if (type === 'EXPENSE') {
    const { shares, payments } = await expenseReimbursements(id);
    return { shares, payments, expense: null, payer: null };
  }
  const linked = await (
    await database()
  ).getFirstAsync<ActivityRecord & { payer: string | null }>(
    `${readRows(`${fullCategoryPath}, personWhoPaid.name AS payer, `)}
    JOIN reimbursements payment ON payment.expenseId = t.id
    LEFT JOIN people personWhoPaid ON personWhoPaid.id = payment.personId
    WHERE payment.transactionId = ?`,
    [id],
  );
  if (!linked) return { shares: [], payments: [], expense: null, payer: null };
  const { payer, ...expense } = linked;
  return { shares: [], payments: [], expense: activityRow(expense), payer };
}

const periodSettingKey = 'homePeriod';

/** Accounts with their balance as of `today` and the last local date that a Transaction used them. */
export async function homeDeckData(today: number): Promise<{
  accounts: DeckAccount[];
  displayRate: DisplayRate | null;
  period: PeriodSetting;
}> {
  const db = await database();
  const [accounts, displayRate, setting] = await Promise.all([
    db.getAllAsync<DeckAccount>(
      `SELECT a.id, a.name, a.currencyCode, ${isFavoriteSql('a')} AS isFavorite,
      a.openingBalanceMinor
        + COALESCE(SUM(CASE WHEN t.date <= ? THEN l.amountMinor END), 0) AS balanceMinor,
      MAX(CASE WHEN t.date <= ? THEN t.date END) AS lastUsedDay
      FROM accounts a
      LEFT JOIN legs l ON l.accountId = a.id
      LEFT JOIN transactions t ON t.id = l.transactionId
      GROUP BY a.id ORDER BY a.name, a.id`,
      [today, today],
    ),
    getDisplayRate(),
    db.getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [
      periodSettingKey,
    ]),
  ]);
  const bills = await creditCardBills(today);
  return {
    accounts: accounts.map((account) => ({
      ...account,
      bill: bills.find((bill) => bill.accountId === account.id),
    })),
    displayRate,
    period: parsePeriodSetting(setting?.value),
  };
}

export async function savePeriodSetting(setting: PeriodSetting): Promise<void> {
  const db = await database();
  await db.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
    periodSettingKey,
    JSON.stringify(setting),
  ]);
}

/** The end-of-day balance of one Account for each day from `start - 1` to `today`. */
export async function homeTrend(
  accountId: number,
  start: number,
  today: number,
): Promise<number[]> {
  const db = await database();
  const [opening, days] = await Promise.all([
    db.getFirstAsync<{ balanceMinor: number }>(
      `SELECT a.openingBalanceMinor + COALESCE((SELECT SUM(l.amountMinor) FROM legs l
        JOIN transactions t ON t.id = l.transactionId
        WHERE l.accountId = a.id AND t.date < ?), 0) AS balanceMinor
      FROM accounts a WHERE a.id = ?`,
      [start, accountId],
    ),
    db.getAllAsync<{ date: number; changeMinor: number }>(
      `SELECT t.date, SUM(l.amountMinor) AS changeMinor FROM legs l
      JOIN transactions t ON t.id = l.transactionId
      WHERE l.accountId = ? AND t.date >= ? AND t.date <= ? GROUP BY t.date`,
      [accountId, start, today],
    ),
  ]);
  const changes = new Map(days.map((row) => [row.date, row.changeMinor]));
  let balance = opening?.balanceMinor ?? 0;
  const points = [balance];
  for (let date = start; date <= today; date++) {
    balance += changes.get(date) ?? 0;
    points.push(balance);
  }
  return points;
}

/** Reportable Expenses for each Currency in the period, up to the same point before, and in all of the previous period. */
export async function homePace(
  accountId: number | null,
  period: Pick<HomePeriod, 'start' | 'end' | 'previousStart' | 'previousSameEnd'>,
): Promise<PaceRow[]> {
  const db = await database();
  const { start, end, previousStart, previousSameEnd } = period;
  return db.getAllAsync<PaceRow>(
    `SELECT a.currencyCode,
    COALESCE(SUM(CASE WHEN t.date >= ? AND t.date < ? THEN t.spendingMinor END), 0) AS spentMinor,
    COALESCE(SUM(CASE WHEN t.date >= ? AND t.date < ? THEN t.spendingMinor END), 0) AS sameMinor,
    COALESCE(SUM(CASE WHEN t.date >= ? AND t.date < ? THEN t.spendingMinor END), 0) AS previousMinor
    FROM report_transactions t JOIN accounts a ON a.id = t.accountId
    WHERE t.spendingMinor IS NOT NULL
    AND ((t.date >= ? AND t.date < ?) OR (t.date >= ? AND t.date < ?))
    ${accountId === null ? '' : 'AND t.accountId = ?'}
    GROUP BY a.currencyCode ORDER BY a.currencyCode`,
    [
      start,
      end,
      previousStart,
      previousSameEnd,
      previousStart,
      start,
      start,
      end,
      previousStart,
      start,
      ...(accountId === null ? [] : [accountId]),
    ],
  );
}
