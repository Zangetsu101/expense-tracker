import { use, useDeferredValue, useState } from 'react';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import { createAccount, setFavoriteAccount } from '@/lib/accounts';
import { epochDay } from '@/lib/database';
import { QueryTimeContext } from '@/lib/query-time';
import { accountsOverviewQuery } from './queries.ts';
import {
  AccountGroups,
  AccountsError,
  AccountsHeader,
  AccountsLayout,
  AccountsSkeleton,
  AddAccountSheet,
  BalanceOverview,
  RefreshAlert,
  WriteError,
  type AccountForm,
} from './view.tsx';

type Writes = {
  pending: boolean;
  favoriteError?: string;
  onAdd: () => void;
  onFavorite: (id: number) => void;
};

function AccountsContent({ today, writes }: { today: number; writes: Writes }) {
  const { data, error, isFetching, refetch } = useSuspenseQuery(accountsOverviewQuery(today));
  return (
    <>
      {data.accounts.length > 0 && <BalanceOverview overview={data} />}
      <AccountsHeader count={data.accounts.length} pending={writes.pending} onAdd={writes.onAdd} />
      {!!error && !isFetching && <RefreshAlert retry={() => void refetch()} />}
      {writes.favoriteError && <WriteError message={writes.favoriteError} />}
      <AccountGroups
        overview={data}
        disabled={writes.pending || isFetching}
        onFavorite={writes.onFavorite}
      />
    </>
  );
}

function AccountsSection({ writes }: { writes: Writes }) {
  const today = useDeferredValue(epochDay(use(QueryTimeContext)));
  const header = <AccountsHeader pending={writes.pending} onAdd={writes.onAdd} />;
  return (
    <QueryBoundary
      resetKey={String(today)}
      pending={<AccountsSkeleton header={header} />}
      error={(retry) => <AccountsError header={header} retry={retry} />}
    >
      <AccountsContent key={today} today={today} writes={writes} />
    </QueryBoundary>
  );
}

const emptyForm: AccountForm = { name: '', currencyCode: '', openingBalance: '0' };

export default function AccountsScreen() {
  const [form, setForm] = useState(emptyForm);
  const [sheet, setSheet] = useState(false);
  const create = useMutation({
    mutationFn: (input: AccountForm) => createAccount(input),
    onSuccess: () => {
      setForm(emptyForm);
      setSheet(false);
    },
  });
  const favorite = useMutation({ mutationFn: (id: number) => setFavoriteAccount(id) });
  const pending = create.isPending || favorite.isPending;
  const writes: Writes = {
    pending,
    favoriteError: favorite.error ? String(favorite.error) : undefined,
    onAdd: () => {
      create.reset();
      setSheet(true);
    },
    onFavorite: (id) => {
      if (!pending) favorite.mutate(id);
    },
  };

  return (
    <AccountsLayout
      sheet={
        sheet && (
          <AddAccountSheet
            form={form}
            onChange={setForm}
            pending={pending}
            error={create.error ? String(create.error) : undefined}
            onSave={() => {
              if (!pending) create.mutate(form);
            }}
            onClose={() => setSheet(false)}
          />
        )
      }
    >
      <AccountsSection writes={writes} />
    </AccountsLayout>
  );
}
