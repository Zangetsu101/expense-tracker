import { infiniteQueryOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import { epochDay } from '@/lib/database';
import { periodsBack, usualPeriods } from '../reports/usual.ts';
import {
  homeDeckData,
  homeListPage,
  homePace,
  homeSearch,
  homeSpendDays,
  homeTrend,
} from './read-home.ts';
import type { ListScope } from './list.ts';
import { homePeriod, periodKey, type PeriodSetting } from './period.ts';

const homeQueryKey = ['home'] as const;

export function homeDeckQuery(now: Date) {
  const today = epochDay(now);
  return queryOptions({
    queryKey: [...homeQueryKey, 'deck', today],
    queryFn: () => homeDeckData(today),
  });
}

export type HomeDeck = Awaited<ReturnType<typeof homeDeckData>>;

/** Writes a new period setting into the cached deck, so that a remount shows it without a refetch. */
export function cachePeriodSetting(client: QueryClient, now: Date, period: PeriodSetting) {
  client.setQueryData(homeDeckQuery(now).queryKey, (deck) => deck && { ...deck, period });
}

export function homeTrendQuery(accountId: number, setting: PeriodSetting, now: Date) {
  const today = epochDay(now);
  return queryOptions({
    queryKey: [...homeQueryKey, 'trend', accountId, periodKey(setting), today],
    queryFn: async () => {
      const period = homePeriod(setting, today);
      return { period, points: await homeTrend(accountId, period.start, today) };
    },
  });
}

export function homePaceQuery(accountId: number | null, setting: PeriodSetting, now: Date) {
  const today = epochDay(now);
  return queryOptions({
    queryKey: [...homeQueryKey, 'pace', accountId, periodKey(setting), today],
    queryFn: async () => {
      const period = homePeriod(setting, today);
      return { period, rows: await homePace(accountId, period) };
    },
  });
}

/** Daily spending for this week or month and the 6 before it, for the comparison with usual. */
export function homeUsualQuery(
  accountId: number | null,
  setting: PeriodSetting & { range: 'week' | 'month' },
  now: Date,
) {
  const today = epochDay(now);
  return queryOptions({
    queryKey: [...homeQueryKey, 'usual', accountId, periodKey(setting), today],
    queryFn: async () => {
      const periods = periodsBack(setting.range, today, setting.monthStart, usualPeriods);
      return {
        periods,
        rows: await homeSpendDays(accountId, periods.at(-1)!.start, periods[0].end),
      };
    },
  });
}

/** The list under the deck: one page for the range of the cards, then one page for each older period. */
export function homeListQuery(scope: ListScope, setting: PeriodSetting, now: Date) {
  const today = epochDay(now);
  return infiniteQueryOptions({
    queryKey: [...homeQueryKey, 'list', scope.accountId, scope.face, periodKey(setting), today],
    queryFn: async ({ pageParam }) => ({
      ...(await homeListPage(scope.accountId, setting, today, pageParam)),
      scope,
    }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.next ?? undefined,
  });
}

/** A search on all dates for the Account in view. */
export function homeSearchQuery(accountId: number | null, query: string, now: Date) {
  return queryOptions({
    queryKey: [...homeQueryKey, 'search', accountId, query.trim(), epochDay(now)],
    queryFn: () => homeSearch(accountId, query),
  });
}
