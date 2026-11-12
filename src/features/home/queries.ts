import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { epochDay } from '@/lib/database';
import { homeData, homeDeckData, homePace, homeTrend } from './read-home.ts';
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

export function homeListQuery(accountId: number | null, now: Date) {
  return queryOptions({
    queryKey: [...homeQueryKey, 'list', accountId, epochDay(now)],
    queryFn: async () => ({ ...(await homeData(accountId)), accountId }),
  });
}

export type HomeList = Awaited<ReturnType<typeof homeData>> & { accountId: number | null };
