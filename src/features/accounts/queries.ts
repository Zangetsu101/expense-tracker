import { queryOptions } from '@tanstack/react-query';
import { listManagedAccounts } from '@/lib/accounts';
import { accountBalances } from '@/lib/reports';

async function readAccountsOverview(today: number) {
  const [accounts, totals] = await Promise.all([listManagedAccounts(), accountBalances(today)]);
  const balances = new Map(totals.map((row) => [row.id, row.balanceMinor]));
  if (accounts.some((account) => !balances.has(account.id)))
    throw new Error('Account balances unavailable.');
  return { accounts, balances };
}

export type AccountsOverview = Awaited<ReturnType<typeof readAccountsOverview>>;

export function accountsOverviewQuery(today: number) {
  return queryOptions({
    queryKey: ['accounts', 'overview', today],
    queryFn: () => readAccountsOverview(today),
  });
}
