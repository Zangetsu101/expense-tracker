import { database } from '@/lib/database';
import type { DisplayRate } from '@/lib/display-rate';
import { getDisplayRate } from '@/lib/display-rate-store';
import type { DeckAccount } from './deck.ts';
import type { PaceRow } from './pace.ts';
import { parsePeriodSetting, type HomePeriod, type PeriodSetting } from './period.ts';
import { periodBack, type ListPeriod, type ListRow, type PeriodRows } from './list.ts';

const listRead = `SELECT t.id, t.type, t.amountMinor, t.date, t.accountId, t.transferAccountId,
  a.name AS accountName, destination.name AS transferAccountName, a.currencyCode,
  c.name AS categoryName, parent.name AS parentCategoryName,
  COALESCE(NULLIF(c.iconKey, ''), NULLIF(parent.iconKey, '')) AS categoryIcon,
  t.note, t.excludeFromReport, lending.kind AS lendingKind, person.name AS personName
  FROM transactions t JOIN accounts a ON a.id = t.accountId
  LEFT JOIN accounts destination ON destination.id = t.transferAccountId
  LEFT JOIN categories c ON c.id = t.categoryId
  LEFT JOIN categories parent ON parent.id = c.parentId
  LEFT JOIN lending_entries lending ON lending.transactionId = t.id
  LEFT JOIN people person ON person.id = lending.personId`;
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
    `SELECT MIN(t.date) AS firstDay FROM transactions t WHERE ${scope.sql}`,
    scope.params,
  );
  const firstDay = first?.firstDay ?? null;
  const olderExists = (period: ListPeriod) => firstDay !== null && firstDay < period.start;
  const periods: PeriodRows[] = [];
  for (let step = steps; ; step++) {
    const period = periodBack(setting, today, step);
    const rows = await db.getAllAsync<ListRow>(
      `${listRead} WHERE ${scope.sql} AND t.date >= ? AND t.date < ? ${listOrder}`,
      [...scope.params, period.start, period.end],
    );
    periods.push({ period, rows });
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
  const fields = ['t.note', 'c.name', 'parent.name', 'a.name', 'destination.name', 'person.name'];
  return db.getAllAsync<ListRow>(
    `${listRead} WHERE ${scope.sql} AND (${fields.map((field) => `${field} LIKE ? ESCAPE '\\'`).join(' OR ')}) ${listOrder}`,
    [...scope.params, ...fields.map(() => like)],
  );
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
      `SELECT a.id, a.name, a.currencyCode, a.isFavorite,
      a.openingBalanceMinor + COALESCE(SUM(CASE WHEN t.date > ? THEN 0
        WHEN t.type = 'EXPENSE' THEN -t.amountMinor
        WHEN t.type = 'INCOME' THEN t.amountMinor
        WHEN t.type = 'TRANSFER' AND t.accountId = a.id THEN -t.amountMinor
        WHEN t.type = 'TRANSFER' AND t.transferAccountId = a.id THEN t.amountMinor
        ELSE 0 END), 0) AS balanceMinor,
      MAX(CASE WHEN t.date <= ? THEN t.date END) AS lastUsedDay
      FROM accounts a
      LEFT JOIN transactions t ON t.accountId = a.id OR (t.type = 'TRANSFER' AND t.transferAccountId = a.id)
      GROUP BY a.id ORDER BY a.name, a.id`,
      [today, today],
    ),
    getDisplayRate(),
    db.getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [
      periodSettingKey,
    ]),
  ]);
  return { accounts, displayRate, period: parsePeriodSetting(setting?.value) };
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
  const change = `CASE
    WHEN t.type = 'EXPENSE' THEN -t.amountMinor
    WHEN t.type = 'INCOME' THEN t.amountMinor
    WHEN t.type = 'TRANSFER' AND t.accountId = ? THEN -t.amountMinor
    ELSE t.amountMinor END`;
  const scope = `(t.accountId = ? OR (t.type = 'TRANSFER' AND t.transferAccountId = ?))`;
  const [opening, days] = await Promise.all([
    db.getFirstAsync<{ balanceMinor: number }>(
      `SELECT a.openingBalanceMinor + COALESCE((SELECT SUM(${change}) FROM transactions t
        WHERE ${scope} AND t.date < ?), 0) AS balanceMinor
      FROM accounts a WHERE a.id = ?`,
      [accountId, accountId, accountId, start, accountId],
    ),
    db.getAllAsync<{ date: number; changeMinor: number }>(
      `SELECT t.date, SUM(${change}) AS changeMinor FROM transactions t
      WHERE ${scope} AND t.date >= ? AND t.date <= ? GROUP BY t.date`,
      [accountId, accountId, accountId, start, today],
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
    COALESCE(SUM(CASE WHEN t.date >= ? AND t.date < ? THEN t.amountMinor END), 0) AS spentMinor,
    COALESCE(SUM(CASE WHEN t.date >= ? AND t.date < ? THEN t.amountMinor END), 0) AS sameMinor,
    COALESCE(SUM(CASE WHEN t.date >= ? AND t.date < ? THEN t.amountMinor END), 0) AS previousMinor
    FROM transactions t JOIN accounts a ON a.id = t.accountId
    WHERE t.type = 'EXPENSE' AND t.excludeFromReport = 0
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
