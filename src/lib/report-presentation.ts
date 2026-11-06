import type { CategorySpending, MonthlySummary } from './reports';

export type ReportPeriod = { year: number; month: number }; // Month is zero-based in the UI.
type AccountMetadata = { id: number; name: string; currencyCode: string };
export type CurrencyReportData = MonthlySummary & {
  netMinor: number;
  accountNames: string[];
  categories: (CategorySpending & { share: number })[];
};

export function currentReportPeriod(now = new Date()): ReportPeriod {
  return { year: now.getFullYear(), month: now.getMonth() };
}

export function parseReportYear(draft: string): number | undefined {
  const year = Number(draft);
  return /^\d{1,4}$/.test(draft) && year >= 1 && year <= 9999 ? year : undefined;
}

export function changeReportYear(period: ReportPeriod, delta: -1 | 1): ReportPeriod {
  return { ...period, year: Math.min(9999, Math.max(1, period.year + delta)) };
}

export function currencyReports(
  report: { summaries: MonthlySummary[]; spending: CategorySpending[] },
  accounts: AccountMetadata[],
  accountId?: number,
): CurrencyReportData[] {
  const scopedAccounts = accounts.filter(
    (account) => accountId === undefined || account.id === accountId,
  );
  const currencies = new Set(scopedAccounts.map((account) => account.currencyCode));
  return [...currencies]
    .map(
      (currencyCode) =>
        report.summaries.find((summary) => summary.currencyCode === currencyCode) ?? {
          currencyCode,
          incomeMinor: 0,
          expenseMinor: 0,
        },
    )
    .map((summary) => ({
      ...summary,
      netMinor: summary.incomeMinor - summary.expenseMinor,
      accountNames: scopedAccounts
        .filter((account) => account.currencyCode === summary.currencyCode)
        .map((account) => account.name),
      categories: report.spending
        .filter((row) => row.currencyCode === summary.currencyCode && row.amountMinor > 0)
        .sort(
          (a, b) =>
            b.amountMinor - a.amountMinor ||
            (a.categoryName ?? '').localeCompare(b.categoryName ?? '') ||
            (a.categoryId ?? -1) - (b.categoryId ?? -1),
        )
        .map((row) => ({
          ...row,
          share:
            summary.expenseMinor === 0
              ? 0
              : Math.min(100, Math.max(0, (row.amountMinor / summary.expenseMinor) * 100)),
        })),
    }))
    .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}
