import { creditCardBills } from '@/lib/credit-cards';
import { queryOptions } from '@tanstack/react-query';
import { listManagedAccounts } from '@/lib/accounts';
import { getDisplayRate } from '@/lib/display-rate-store';
import { investmentBalances } from '@/lib/investments';
import { accountBalances } from '@/lib/reports';

async function readAccountsOverview(today: number) {
  const accountsRead = listManagedAccounts().then(async (accounts) => {
    const [investments, rate] = accounts.some((account) => account.isInvestment)
      ? await Promise.all([investmentBalances(today), getDisplayRate()])
      : ([[], null] as const);
    return { accounts, investments, rate };
  });
  const [{ accounts, investments, rate }, totals, bills] = await Promise.all([
    accountsRead,
    accountBalances(today),
    creditCardBills(today),
  ]);
  const balances = new Map(totals.map((row) => [row.id, row.balanceMinor]));
  if (accounts.some((account) => !balances.has(account.id)))
    throw new Error('Account balances unavailable.');
  return { accounts, balances, bills, investments, rate };
}

export type AccountsOverview = Awaited<ReturnType<typeof readAccountsOverview>>;

export function accountsOverviewQuery(today: number) {
  return queryOptions({
    queryKey: ['accounts', 'overview', today],
    queryFn: () => readAccountsOverview(today),
  });
}
