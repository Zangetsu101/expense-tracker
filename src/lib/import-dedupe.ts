import type { MoneyLoverRow } from './csv';

export type LegacyImportRow = {
  date: number;
  account: string;
  currency: string;
  category: string | null;
  amountMinor: number;
  type: string;
  note: string | null;
  excludeFromReport: number;
};

function identity(row: MoneyLoverRow): string {
  return JSON.stringify([
    row.date,
    row.account.trim().toLowerCase(),
    row.currency.trim().toUpperCase(),
    row.category.trim().toLowerCase(),
    row.amount,
    row.note,
    row.excludeFromReport,
  ]);
}

export function hasAmbiguousLegacyImport(
  rows: MoneyLoverRow[],
  legacy: LegacyImportRow[],
): boolean {
  const identities = new Set(rows.map(identity));
  return legacy.some((row) => {
    if (
      !Number.isSafeInteger(row.amountMinor) ||
      !Number.isSafeInteger(row.date) ||
      !['EXPENSE', 'INCOME'].includes(row.type)
    )
      return true;
    const date = new Date(row.date * 86400000).toISOString().slice(0, 10);
    const amountMinor = row.type === 'EXPENSE' ? -row.amountMinor : row.amountMinor;
    const amount = amountMinor / 100;
    if (row.category === null)
      return rows.some(
        (candidate) =>
          candidate.date === date &&
          candidate.amountMinor === amountMinor &&
          candidate.account.trim().toLowerCase() === row.account.trim().toLowerCase() &&
          candidate.currency.trim().toUpperCase() === row.currency.trim().toUpperCase() &&
          candidate.note === (row.note ?? '') &&
          candidate.excludeFromReport === Boolean(row.excludeFromReport),
      );
    return identities.has(
      identity({
        date,
        account: row.account,
        currency: row.currency,
        category: row.category,
        amount,
        amountMinor,
        note: row.note ?? '',
        excludeFromReport: Boolean(row.excludeFromReport),
        sourceId: '',
      }),
    );
  });
}

/** Match rows by content and distinguish identical rows within an export by occurrence. */
export function importRowKeys(rows: MoneyLoverRow[]): string[] {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const content = identity(row);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return JSON.stringify([content, occurrence]);
  });
}
