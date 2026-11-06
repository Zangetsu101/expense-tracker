import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { resolveHomeAccount, watchHomeReopen } from '@/lib/account-selection';
import { homeAccountsQuery, homeQueryKey, homeSnapshotQuery, type HomeSnapshot } from '@/lib/home-queries';

export function useHome() {
  const client = useQueryClient();
  const [selection, setSelection] = useState<number | null | undefined>(undefined);
  const [focused, setFocused] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [lastDisplayed, setLastDisplayed] = useState<HomeSnapshot>();

  useFocusEffect(useCallback(() => {
    setNow(new Date());
    setFocused(true);
    void client.invalidateQueries({ queryKey: homeQueryKey });
    return () => setFocused(false);
  }, [client]));
  useEffect(() => watchHomeReopen(AppState, () => {
    setSelection(undefined);
    setNow(new Date());
    void client.invalidateQueries({ queryKey: homeQueryKey });
  }), [client]);

  const accountsQuery = useQuery({ ...homeAccountsQuery(), enabled: focused });
  const accounts = accountsQuery.data;
  const accountId = accounts ? resolveHomeAccount(accounts, selection) : null;
  const resolvingFavorite = selection === undefined && (accountsQuery.isFetching || accountsQuery.isError);
  if (accounts && !resolvingFavorite && selection !== accountId) setSelection(accountId);
  const snapshotQuery = useQuery({ ...homeSnapshotQuery(accountId, now), enabled: focused && !!accounts && !resolvingFavorite });
  const snapshot = snapshotQuery.data ?? lastDisplayed;
  if (snapshotQuery.data && snapshotQuery.data !== lastDisplayed) setLastDisplayed(snapshotQuery.data);

  const loading = accountsQuery.isFetching || snapshotQuery.isFetching || (!accounts && !accountsQuery.isError) || (!!accounts && snapshotQuery.isPending && !snapshotQuery.isError);
  const error = (!accountsQuery.isFetching && accountsQuery.error) || (!snapshotQuery.isFetching && snapshotQuery.error);
  const retry = () => {
    if (accountsQuery.isError || !accounts) void accountsQuery.refetch();
    if (accounts && !resolvingFavorite) void snapshotQuery.refetch();
  };
  const selectAccount = (id: number | null) => {
    setSelection(id);
    if (id === accountId) retry();
  };

  return { accounts: accounts ?? [], accountsReady: !!accounts, accountId, snapshot, loading, error, retry, selectAccount };
}
