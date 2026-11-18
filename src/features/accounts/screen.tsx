import { use, useDeferredValue, useState } from 'react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import {
  createAccount,
  reverseAmountSign,
  updateAccount,
  setFavoriteAccount,
  type ManagedAccount,
} from '@/lib/accounts';
import { epochDay } from '@/lib/database';
import { QueryTimeContext } from '@/lib/query-time';
import { LendingCard } from '@/features/lending/overview-screen';
import { accountsOverviewQuery } from './queries.ts';
import {
  AccountGroups,
  AccountsBalanceSkeleton,
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

const emptyForm: AccountForm = { name: '', currencyCode: '', openingBalance: '0' };

export default function AccountsScreen() {
  const overview = useQuery({
    ...accountsOverviewQuery(epochDay(use(QueryTimeContext))),
    enabled: false,
  });
  const [form, setForm] = useState(emptyForm);
  const [sheet, setSheet] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [favoriteError, setFavoriteError] = useState<string>();

  async function save() {
    if (pending) return;
    setPending(true);
    setFormError(undefined);
    try {
      const input = {
        ...form,
        openingBalance: form.isCreditCard
          ? reverseAmountSign(form.openingBalance)
          : form.openingBalance,
      };
      if (form.id) await updateAccount(form.id, input);
      else await createAccount(input);
      setForm(emptyForm);
      setSheet(false);
    } catch (e) {
      setFormError(String(e));
    } finally {
      setPending(false);
    }
  }
  async function makeFavorite(id: number) {
    if (pending) return;
    setPending(true);
    setFavoriteError(undefined);
    try {
      await setFavoriteAccount(id);
    } catch (e) {
      setFavoriteError(String(e));
    } finally {
      setPending(false);
    }
  }
  const writes: Writes = {
    pending,
    favoriteError,
    onEdit: (account) => {
      setForm({
        id: account.id,
        name: account.name,
        currencyCode: account.currencyCode,
        openingBalance: String(
          (account.card ? -account.openingBalanceMinor : account.openingBalanceMinor) / 100,
        ),
        isCreditCard: !!account.card,
        parentAccountId: account.card?.parentAccountId,
        statementDay: account.card?.statementDay,
        dueDay: account.card?.dueDay,
      });
      setFormError(undefined);
      setSheet(true);
    },
    onAdd: () => {
      setForm(emptyForm);
      setFormError(undefined);
      setSheet(true);
    },
    onFavorite: (id) => void makeFavorite(id),
  };

  return (
    <AccountsLayout
      sheet={
        sheet && (
          <AddAccountSheet
            accounts={overview.data?.accounts ?? []}
            form={form}
            onChange={setForm}
            pending={pending}
            error={formError}
            onSave={() => void save()}
            onClose={() => setSheet(false)}
          />
        )
      }
    >
      <AccountsSection writes={writes} />
    </AccountsLayout>
  );
}
