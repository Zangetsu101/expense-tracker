import { isoDay, type DayRange } from './periods.ts';
import type { PeriodKind } from './usual-spending.ts';

export type TrendPage = 'pace' | 'movers' | 'net-worth';
/** The route params of a Trend page. */
export type TrendParams = { accountId?: string; currency?: string; kind?: string };

export function trendHref(
  page: TrendPage,
  accountId: number | undefined | null,
  currency: string,
  kind: PeriodKind = 'month',
) {
  return {
    pathname: `/reports/${page}` as const,
    params: {
      currency,
      ...(accountId == null ? {} : { accountId: String(accountId) }),
      ...(kind === 'month' ? {} : { kind }),
    },
  };
}

export function parseKind(value: string | undefined): PeriodKind {
  return value === 'week' ? 'week' : 'month';
}

/** The Transaction search with the filters of a report row: the Category, the dates, the Account and Expense. */
export function transactionsHref(
  categoryId: number,
  range: DayRange,
  accountId: number | undefined | null,
) {
  return {
    pathname: '/transactions' as const,
    params: {
      categoryId: String(categoryId),
      startDate: isoDay(range.start),
      endDate: isoDay(range.end - 1),
      type: 'EXPENSE',
      ...(accountId == null ? {} : { accountId: String(accountId) }),
    },
  };
}
