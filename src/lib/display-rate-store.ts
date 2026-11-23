import { database } from './database.ts';
import { usableRate, validDisplayRate, type DisplayRate } from './display-rate.ts';

export async function getDisplayRate(): Promise<DisplayRate | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'displayRate'",
  );
  return usableRate(row ? (JSON.parse(row.value) as DisplayRate) : null);
}

export async function saveDisplayRate(rate: DisplayRate | null): Promise<void> {
  if (rate && !validDisplayRate(rate))
    throw new Error('Enter two different currency codes and a positive rate.');
  const db = await database();
  if (rate)
    await db.runAsync(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('displayRate', ?)",
      [JSON.stringify(rate)],
    );
  else await db.runAsync("DELETE FROM app_settings WHERE key = 'displayRate'");
}
