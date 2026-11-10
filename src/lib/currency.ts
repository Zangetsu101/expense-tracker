/** The Currency of the Cash Account that a new install creates. */
export const defaultCurrencyCode = 'BDT';

/** The short symbol of a Currency. */
export function currencySymbol(currency: string): string {
  if (currency === 'BDT') return '৳';
  if (currency === 'USD') return '$';
  return `${currency} `;
}
