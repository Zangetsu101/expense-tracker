import type { DisplayRate } from '@/lib/display-rate';
import type { CurrencyBalance } from './balances.ts';

/** Spending in one Currency: in the period, in the previous period up to the same point, and in all of the previous period. */
export type PaceRow = {
  currencyCode: string;
  spentMinor: number;
  sameMinor: number;
  previousMinor: number;
};

/**
 * The sum of the amounts in the target Currency. A Display Rate of `rate` means one `base` equals
 * `rate` of `quote`. Returns null when an amount cannot be converted.
 */
export function convertTo(
  rows: { currencyCode: string; amountMinor: number }[],
  rate: DisplayRate | null,
  target: string,
): number | null {
  let total = 0;
  for (const row of rows) {
    if (row.currencyCode === target) total += row.amountMinor;
    else if (rate && row.currencyCode === rate.base && target === rate.quote)
      total += row.amountMinor * rate.rate;
    else if (rate && row.currencyCode === rate.quote && target === rate.base)
      total += row.amountMinor / rate.rate;
    else return null;
  }
  return Math.round(total);
}

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
  const usableRate = many ? rate : null;
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
