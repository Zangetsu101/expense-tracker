export type DisplayRate = { base: string; quote: string; rate: number };

export function validDisplayRate(value: DisplayRate): boolean {
  return (
    /^[A-Z]{3}$/.test(value.base) &&
    /^[A-Z]{3}$/.test(value.quote) &&
    value.base !== value.quote &&
    Number.isFinite(value.rate) &&
    value.rate > 0
  );
}

export function combinedMinor(
  rows: { currencyCode: string; amountMinor: number }[],
  rate: DisplayRate | null,
): number | null {
  const currencies = new Set(rows.map((row) => row.currencyCode));
  if (currencies.size === 0) return null;
  if (currencies.size === 1) return rows.reduce((sum, row) => sum + row.amountMinor, 0);
  if (
    !rate ||
    !validDisplayRate(rate) ||
    currencies.size !== 2 ||
    !currencies.has(rate.base) ||
    !currencies.has(rate.quote)
  )
    return null;
  const total = rows.reduce(
    (sum, row) => sum + row.amountMinor * (row.currencyCode === rate.base ? 1 : 1 / rate.rate),
    0,
  );
  return Number.isSafeInteger(Math.round(total)) ? Math.round(total) : null;
}

export function combinedCategorySpending(
  rows: {
    categoryId: number | null;
    categoryName: string | null;
    currencyCode: string;
    amountMinor: number;
  }[],
  rate: DisplayRate | null,
) {
  if (
    !rate ||
    !validDisplayRate(rate) ||
    rows.some((row) => row.currencyCode !== rate.base && row.currencyCode !== rate.quote)
  )
    return [];
  const totals = new Map<
    number | null,
    { categoryId: number | null; categoryName: string | null; amountMinor: number }
  >();
  for (const row of rows) {
    const prior = totals.get(row.categoryId);
    const amountMinor =
      (prior?.amountMinor ?? 0) +
      row.amountMinor / (row.currencyCode === rate.base ? 1 : rate.rate);
    if (!Number.isSafeInteger(Math.round(amountMinor))) return [];
    totals.set(row.categoryId, {
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      amountMinor,
    });
  }
  return [...totals.values()]
    .map((row) => ({ ...row, amountMinor: Math.round(row.amountMinor) }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

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
