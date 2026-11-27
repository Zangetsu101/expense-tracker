import { use, useDeferredValue, useState, useTransition } from 'react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import { setFavoriteAccount, type ManagedAccount } from '@/lib/accounts';
import { epochDay } from '@/lib/database';
import { QueryTimeContext } from '@/lib/query-time';
import { LendingCard } from '@/features/lending/overview-screen';
import { useAccountSheet } from './account-editor';
import { accountsOverviewQuery } from './queries.ts';
import {
  AccountGroups,
  AccountsBalanceSkeleton,
  AccountsError,
  AccountsHeader,
  AccountsLayout,
  AccountsSkeleton,
  BalanceOverview,
  InvestmentGroup,
  RefreshAlert,
  WriteError,
} from './view.tsx';

type Writes = {
  pending: boolean;
  favoriteError?: string;
  onAdd: () => void;
  onEdit: (account: ManagedAccount) => void;
  onFavorite: (id: number) => void;
};

function AccountsContent({ today, writes }: { today: number; writes: Writes }) {
  const { data, error, isFetching, refetch } = useSuspenseQuery(accountsOverviewQuery(today));
  return (
    <>
      <AccountsHeader count={data.accounts.length} pending={writes.pending} onAdd={writes.onAdd} />
      {!!error && !isFetching && <RefreshAlert retry={() => void refetch()} />}
      {writes.favoriteError && <WriteError message={writes.favoriteError} />}
      <AccountGroups
        overview={data}
        disabled={writes.pending || isFetching}
        onFavorite={writes.onFavorite}
        onEdit={writes.onEdit}
      />
      <InvestmentGroup overview={data} />
    </>
  );
}

function AccountBalanceCard({ today }: { today: number }) {
  const { data, isPending } = useQuery({ ...accountsOverviewQuery(today), enabled: false });
  if (isPending) return <AccountsBalanceSkeleton />;
  return data?.accounts.length ? <BalanceOverview overview={data} /> : null;
}

function AccountsSection({ writes }: { writes: Writes }) {
  const today = useDeferredValue(epochDay(use(QueryTimeContext)));
  const header = <AccountsHeader pending={writes.pending} onAdd={writes.onAdd} />;
  return (
    <>
      <AccountBalanceCard today={today} />
      <LendingCard />
      <QueryBoundary
        resetKey={String(today)}
        pending={<AccountsSkeleton header={header} />}
        error={(retry) => <AccountsError header={header} retry={retry} />}
      >
        <AccountsContent key={today} today={today} writes={writes} />
      </QueryBoundary>
    </>
  );
}

export default function AccountsScreen() {
  const overview = useQuery({
    ...accountsOverviewQuery(epochDay(use(QueryTimeContext))),
    enabled: false,
  });
  const accountSheet = useAccountSheet(overview.data?.accounts ?? []);
  const [favoritePending, startFavoriteSave] = useTransition();
  const [favoriteError, setFavoriteError] = useState<string>();
  const pending = favoritePending || accountSheet.pending;
  function makeFavorite(id: number) {
    if (pending) return;
    setFavoriteError(undefined);
    startFavoriteSave(async () => {
      try {
        await setFavoriteAccount(id);
      } catch (error) {
        setFavoriteError(String(error));
      }
    });
  }
  const writes: Writes = {
    pending,
    favoriteError,
    onEdit: accountSheet.edit,
    onAdd: accountSheet.add,
    onFavorite: makeFavorite,
  };

  return (
    <AccountsLayout sheet={accountSheet.sheet}>
      <AccountsSection writes={writes} />
    </AccountsLayout>
  );
}
