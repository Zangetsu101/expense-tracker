import { convertTo, validDisplayRate, type DisplayRate } from '@/lib/display-rate';
import type { CurrencyBalance } from './balances.ts';

/** Spending in one Currency: in the period, in the previous period up to the same point, and in all of the previous period. */
export type PaceRow = {
  currencyCode: string;
  spentMinor: number;
  sameMinor: number;
  previousMinor: number;
};

export type PaceSummary = {
  /** One total when all balances are in one Currency or the Display Rate converts them. */
  total: { currencyCode: string; amountMinor: number } | null;
  /** The rate that made the total, when the total combines two Currencies. */
  rate: DisplayRate | null;
  /** The balance in each Currency, the main Currency first. */
  parts: CurrencyBalance[];
  pace: PaceRow;
  /** The Currency that Pace counts when it must leave out the other Currencies. */
  paceOnly: string | null;
};

export function paceSummary({
  balances,
  pace,
  rate,
  mainCurrency,
}: {
  balances: CurrencyBalance[];
  pace: PaceRow[];
  rate: DisplayRate | null;
  mainCurrency: string;
}): PaceSummary {
  const parts = [...balances].sort(
    (a, b) =>
      Number(b.currencyCode === mainCurrency) - Number(a.currencyCode === mainCurrency) ||
      a.currencyCode.localeCompare(b.currencyCode),
  );
  const many = new Set([...balances, ...pace].map((row) => row.currencyCode)).size > 1;
  const usableRate = many && rate && validDisplayRate(rate) ? rate : null;
  const convert = (pick: (row: PaceRow) => number) =>
    convertTo(
      pace.map((row) => ({ currencyCode: row.currencyCode, amountMinor: pick(row) })),
      usableRate,
      mainCurrency,
    );
  const totalMinor = convertTo(
    balances.map((row) => ({ currencyCode: row.currencyCode, amountMinor: row.balanceMinor })),
    usableRate,
    mainCurrency,
  );
  const spentMinor = convert((row) => row.spentMinor);
  const sameMinor = convert((row) => row.sameMinor);
  const previousMinor = convert((row) => row.previousMinor);
  if (totalMinor !== null && spentMinor !== null && sameMinor !== null && previousMinor !== null)
    return {
      total: { currencyCode: mainCurrency, amountMinor: totalMinor },
      rate: usableRate,
      parts,
      pace: { currencyCode: mainCurrency, spentMinor, sameMinor, previousMinor },
      paceOnly: null,
    };
  return {
    total: null,
    rate: null,
    parts,
    pace: pace.find((row) => row.currencyCode === mainCurrency) ?? {
      currencyCode: mainCurrency,
      spentMinor: 0,
      sameMinor: 0,
      previousMinor: 0,
    },
    paceOnly: mainCurrency,
  };
}

/**
 * The rows in the target Currency. The Display Rate converts the other Currencies. When it
 * cannot convert a row, only the rows in the target Currency stay, and `only` is true.
 */
export function rowsInCurrency<R extends { currencyCode: string; amountMinor: number }>(
  rows: R[],
  rate: DisplayRate | null,
  target: string,
): { rows: R[]; only: boolean } {
  const usable = rate && validDisplayRate(rate) ? rate : null;
  const converted: R[] = [];
  for (const row of rows) {
    const amountMinor = convertTo([row], usable, target);
    if (amountMinor === null)
      return { rows: rows.filter((item) => item.currencyCode === target), only: true };
    converted.push({ ...row, currencyCode: target, amountMinor });
  }
  return { rows: converted, only: false };
}
