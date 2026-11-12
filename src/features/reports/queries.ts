import { queryOptions } from '@tanstack/react-query';
import { listManagedAccounts } from '@/lib/accounts';
import { monthlyReport } from '@/lib/reports';

const reportsKey = ['reports'] as const;

export function managedAccountsQuery() {
  return queryOptions({ queryKey: [...reportsKey, 'accounts'], queryFn: listManagedAccounts });
}

/** `month` is zero-based, as in the UI. */
export function monthlyReportQuery(year: number, month: number, accountId: number | undefined) {
  return queryOptions({
    queryKey: [...reportsKey, 'monthly', year, month, accountId ?? null],
    queryFn: () => monthlyReport(year, month + 1, accountId),
  });
}
