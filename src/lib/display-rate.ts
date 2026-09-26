import { database } from '@/lib/database';

export type DisplayRate = { base: string; quote: string; rate: number };
type Settings = { favoriteAccountId: number | null; displayRate: DisplayRate | null };

export function validDisplayRate(value: DisplayRate): boolean {
  return /^[A-Z]{3}$/.test(value.base) && /^[A-Z]{3}$/.test(value.quote) &&
    value.base !== value.quote && Number.isFinite(value.rate) && value.rate > 0;
}

export function combinedMinor(rows: { currencyCode: string; amountMinor: number }[], rate: DisplayRate | null): number | null {
  const currencies = new Set(rows.map((row) => row.currencyCode));
  if (currencies.size === 0) return null;
  if (currencies.size === 1) return rows.reduce((sum, row) => sum + row.amountMinor, 0);
  if (!rate || !validDisplayRate(rate) || currencies.size !== 2 ||
    !currencies.has(rate.base) || !currencies.has(rate.quote)) return null;
  const total = rows.reduce((sum, row) => sum + row.amountMinor * (row.currencyCode === rate.base ? 1 : 1 / rate.rate), 0);
  return Number.isSafeInteger(Math.round(total)) ? Math.round(total) : null;
}

export function combinedCategorySpending(rows: { categoryId: number | null; categoryName: string | null; currencyCode: string; amountMinor: number }[], rate: DisplayRate | null) {
  if (!rate || !validDisplayRate(rate) || rows.some((row) => row.currencyCode !== rate.base && row.currencyCode !== rate.quote)) return [];
  const totals = new Map<number | null, { categoryId: number | null; categoryName: string | null; amountMinor: number }>();
  for (const row of rows) {
    const prior = totals.get(row.categoryId);
    const amountMinor = (prior?.amountMinor ?? 0) + row.amountMinor / (row.currencyCode === rate.base ? 1 : rate.rate);
    if (!Number.isSafeInteger(Math.round(amountMinor))) return [];
    totals.set(row.categoryId, { categoryId: row.categoryId, categoryName: row.categoryName, amountMinor });
  }
  return [...totals.values()].map((row) => ({ ...row, amountMinor: Math.round(row.amountMinor) }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

export async function getDisplayRate(): Promise<DisplayRate | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = 'backupSettings'");
  const rate = row ? (JSON.parse(row.value) as Settings).displayRate : null;
  return rate && validDisplayRate(rate) ? rate : null;
}

export async function saveDisplayRate(rate: DisplayRate | null): Promise<void> {
  if (rate && !validDisplayRate(rate)) throw new Error('Enter two different currency codes and a positive rate.');
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = 'backupSettings'");
    const settings: Settings = row ? JSON.parse(row.value) : { favoriteAccountId: null, displayRate: null };
    settings.displayRate = rate;
    await tx.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('backupSettings', ?)", [JSON.stringify(settings)]);
  });
}
