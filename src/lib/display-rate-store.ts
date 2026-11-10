import { database } from './database.ts';
import { validDisplayRate, type DisplayRate } from './display-rate.ts';

type Settings = { favoriteAccountId: number | null; displayRate: DisplayRate | null };

export async function getDisplayRate(): Promise<DisplayRate | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'backupSettings'",
  );
  const rate = row ? (JSON.parse(row.value) as Settings).displayRate : null;
  return rate && validDisplayRate(rate) ? rate : null;
}

export async function saveDisplayRate(rate: DisplayRate | null): Promise<void> {
  if (rate && !validDisplayRate(rate))
    throw new Error('Enter two different currency codes and a positive rate.');
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'backupSettings'",
    );
    const settings: Settings = row
      ? JSON.parse(row.value)
      : { favoriteAccountId: null, displayRate: null };
    settings.displayRate = rate;
    await tx.runAsync(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('backupSettings', ?)",
      [JSON.stringify(settings)],
    );
  });
}
