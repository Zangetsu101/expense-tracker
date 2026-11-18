import type { CategorySpending, MonthlySummary } from './reports';

export type CategoryShare = {
  id: number | null;
  name: string | null;
  amountMinor: number;
  /** The percent of the Expenses in the Currency. */
  share: number;
};
export type CategoryNode = CategoryShare & { children: CategoryShare[] };
export type CurrencyTotals = MonthlySummary & { netMinor: number; categories: CategoryNode[] };

/** A change against usual of at least this part of usual gets a marker. */
export const markerChange = 0.2;

/** The Currencies of the Accounts in scope, the main Currency first. */
export function scopeCurrencies(
  accounts: { id: number; currencyCode: string }[],
  accountId: number | undefined,
  mainCurrency: string,
): string[] {
  const codes = new Set(
    accounts
      .filter((account) => accountId === undefined || account.id === accountId)
      .map((account) => account.currencyCode),
  );
  return [...codes].sort(
    (a, b) => Number(b === mainCurrency) - Number(a === mainCurrency) || a.localeCompare(b),
  );
}

const byAmount = (a: CategoryShare, b: CategoryShare) =>
  b.amountMinor - a.amountMinor ||
  (a.name ?? '').localeCompare(b.name ?? '') ||
  (a.id ?? -1) - (b.id ?? -1);

/** Income, Expense and Net in one Currency, and its parent Categories with their children. */
export function currencyTotals(
  report: { summaries: MonthlySummary[]; spending: CategorySpending[] },
  currencyCode: string,
): CurrencyTotals {
  const summary = report.summaries.find((row) => row.currencyCode === currencyCode) ?? {
    currencyCode,
    incomeMinor: 0,
    expenseMinor: 0,
  };
  const share = (amountMinor: number) =>
    summary.expenseMinor === 0
      ? 0
      : Math.min(100, Math.max(0, (amountMinor / summary.expenseMinor) * 100));
  const parents = new Map<number | null, CategoryNode>();
  for (const row of report.spending) {
    if (row.currencyCode !== currencyCode || row.amountMinor <= 0) continue;
    const node = parents.get(row.topId) ?? {
      id: row.topId,
      name: row.topName,
      amountMinor: 0,
      share: 0,
      children: [],
    };
    node.amountMinor += row.amountMinor;
    node.children.push({
      id: row.categoryId,
      name: row.categoryName,
      amountMinor: row.amountMinor,
      share: share(row.amountMinor),
    });
    parents.set(row.topId, node);
  }
  return {
    ...summary,
    netMinor: summary.incomeMinor - summary.expenseMinor,
    categories: [...parents.values()]
      .map((node) => ({
        ...node,
        share: share(node.amountMinor),
        children: node.children.sort(byAmount),
      }))
      .sort(byAmount),
  };
}

/** True when a row has children to show: more than one, or one that is not the row itself. */
export function hasChildren(node: { id: number | null; children: { id: number | null }[] }) {
  return node.children.length > 1 || node.children.some((child) => child.id !== node.id);
}

/** 'up' or 'down' when spending differs from usual by at least a fifth of usual. */
export function changeMark(nowMinor: number, usualMinor: number): 'up' | 'down' | null {
  if (usualMinor <= 0) return nowMinor > 0 ? 'up' : null;
  const change = (nowMinor - usualMinor) / usualMinor;
  return change >= markerChange ? 'up' : change <= -markerChange ? 'down' : null;
}
