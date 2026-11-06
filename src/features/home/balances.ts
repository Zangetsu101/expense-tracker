import type { AccountBalance } from '@/lib/reports';

export type CurrencyBalance = { currencyCode: string; balanceMinor: number };

/** Balance for the Home selection: one account, or per-currency totals across all accounts. */
export function homeBalances(
  balances: Pick<AccountBalance, 'id' | 'currencyCode' | 'balanceMinor'>[],
  selectedId: number | null,
): CurrencyBalance[] {
  const totals = new Map<string, number>();
  for (const row of balances) {
    if (selectedId !== null && row.id !== selectedId) continue;
    totals.set(row.currencyCode, (totals.get(row.currencyCode) ?? 0) + row.balanceMinor);
  }
  return [...totals]
    .map(([currencyCode, balanceMinor]) => ({ currencyCode, balanceMinor }))
    .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}
