import type { LendingEntry } from './lending.ts';

export type LendingTotal = {
  personId: number;
  currencyCode: string;
  direction: 'LENT' | 'BORROWED';
  principalMinor: number;
  repaidMinor: number;
  writtenOffMinor: number;
  outstandingMinor: number;
  overpaidMinor: number;
};

/** The totals for each person, Currency and direction. */
export function lendingTotals(
  rows: Pick<LendingEntry, 'personId' | 'kind' | 'currencyCode' | 'amountMinor'>[],
): LendingTotal[] {
  const map = new Map<string, LendingTotal>();
  for (const row of rows) {
    const direction = ['LEND', 'RECEIVE_REPAYMENT', 'WRITE_OFF_LENT'].includes(row.kind)
      ? 'LENT'
      : 'BORROWED';
    const key = `${row.personId}:${row.currencyCode}:${direction}`;
    const total = map.get(key) ?? {
      personId: row.personId,
      currencyCode: row.currencyCode,
      direction,
      principalMinor: 0,
      repaidMinor: 0,
      writtenOffMinor: 0,
      outstandingMinor: 0,
      overpaidMinor: 0,
    };
    if (row.kind === 'LEND' || row.kind === 'BORROW') total.principalMinor += row.amountMinor;
    else if (row.kind === 'WRITE_OFF_LENT' || row.kind === 'WRITE_OFF_BORROWED')
      total.writtenOffMinor += row.amountMinor;
    else total.repaidMinor += row.amountMinor;
    const balance = total.principalMinor - total.repaidMinor - total.writtenOffMinor;
    total.outstandingMinor = Math.max(0, balance);
    total.overpaidMinor = Math.max(0, -balance);
    if (
      ![total.principalMinor, total.repaidMinor, total.writtenOffMinor].every(Number.isSafeInteger)
    )
      throw new Error('Lending total exceeds supported range.');
    map.set(key, total);
  }
  return [...map.values()].sort(
    (a, b) =>
      a.personId - b.personId ||
      a.currencyCode.localeCompare(b.currencyCode) ||
      a.direction.localeCompare(b.direction),
  );
}
