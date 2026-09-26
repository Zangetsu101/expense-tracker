import type { MoneyLoverRow } from './csv';

/** Match rows by content and distinguish identical rows within an export by occurrence. */
export function importRowKeys(rows: MoneyLoverRow[]): string[] {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const identity = JSON.stringify([
      row.date, row.account.trim().toLowerCase(), row.currency.trim().toUpperCase(),
      row.category.trim().toLowerCase(), row.amount, row.note, row.excludeFromReport,
    ]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return JSON.stringify([identity, occurrence]);
  });
}
