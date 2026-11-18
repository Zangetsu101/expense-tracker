import { queryOptions } from '@tanstack/react-query';
import { listManagedAccounts } from '@/lib/accounts';
import { rangeReport, spendHistory } from '@/lib/reports';
import { netWorthData, reportSettings } from './read-reports.ts';
import type { ReportRange } from './range.ts';
import type { PeriodKind } from '@/lib/usual-spending';

const reportsKey = ['reports'] as const;

export function managedAccountsQuery() {
  return queryOptions({ queryKey: [...reportsKey, 'accounts'], queryFn: listManagedAccounts });
}

export function reportSettingsQuery() {
  return queryOptions({ queryKey: [...reportsKey, 'settings'], queryFn: reportSettings });
}

export function rangeReportQuery(range: ReportRange, accountId: number | undefined) {
  return queryOptions({
    queryKey: [...reportsKey, 'range', range.start, range.end, accountId ?? null],
    queryFn: () => rangeReport(range.start, range.end, accountId),
  });
}

/** Daily spending for the current period and the 7 periods before it: enough for Pace and both Movers modes. */
export function trendQuery(
  accountId: number | null,
  kind: PeriodKind,
  monthStart: number,
  today: number,
) {
  return queryOptions({
    queryKey: [...reportsKey, 'trend', accountId, kind, monthStart, today],
    queryFn: () => spendHistory(accountId, kind, monthStart, today, 7),
  });
}

export function netWorthQuery(accountId: number | null, today: number) {
  return queryOptions({
    queryKey: [...reportsKey, 'netWorth', accountId, today],
    queryFn: () => netWorthData(accountId, today),
  });
}
