import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { epochDay, listAccounts } from '@/lib/database';
import { homeData } from './read-home.ts';
import { accountBalances } from '@/lib/reports';
import { homeBalances } from './balances.ts';

const homeQueryKey = ['home'] as const;

export function homeAccountsQuery(session = 0) {
  return queryOptions({ queryKey: [...homeQueryKey, 'accounts', session], queryFn: listAccounts });
}

export function homeSnapshotQuery(accountId: number | null, now: Date) {
  const today = epochDay(now);
  return queryOptions({
    queryKey: [...homeQueryKey, 'snapshot', accountId, today],
    queryFn: async () => {
      const [activity, balances] = await Promise.all([
        homeData(now, accountId),
        accountBalances(today),
      ]);
      return { ...activity, balances: homeBalances(balances, accountId), accountId };
    },
  });
}

export type HomeSnapshot = Awaited<ReturnType<typeof homeData>> & {
  balances: ReturnType<typeof homeBalances>;
  accountId: number | null;
};

export function invalidateHome(client: QueryClient) {
  return client.invalidateQueries({ queryKey: homeQueryKey });
}
