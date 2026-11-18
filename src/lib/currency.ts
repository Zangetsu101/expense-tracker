/** The Currency of the Cash Account that a new install creates. */
export const defaultCurrencyCode = 'BDT';

/** The short symbol of a Currency. */
export function currencySymbol(currency: string): string {
  if (currency === 'BDT') return '৳';
  if (currency === 'USD') return '$';
  return `${currency} `;
}

/** A sort order that puts the main Currency first and the other Currencies in code order. */
export function byMainCurrency(main: string) {
  return (a: string, b: string) => Number(b === main) - Number(a === main) || a.localeCompare(b);
}
