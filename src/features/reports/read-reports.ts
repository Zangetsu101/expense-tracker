import { defaultCurrencyCode } from '@/lib/currency';
import { database } from '@/lib/database';
import { getDisplayRate } from '@/lib/display-rate-store';
import { parsePeriodSetting } from '../home/period.ts';
import type { NetWorthInput } from './net-worth.ts';
import { parseFiscalStart, type RangeSettings } from './range.ts';

const fiscalStartKey = 'reportFiscalStart';

/** The start day of the month that Home sets, and the first month of the fiscal year. */
export async function reportSettings(): Promise<RangeSettings> {
  const db = await database();
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM app_settings WHERE key IN (?, ?)',
    ['homePeriod', fiscalStartKey],
  );
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  return {
    monthStart: parsePeriodSetting(value('homePeriod')).monthStart,
    fiscalStart: parseFiscalStart(value(fiscalStartKey)),
  };
}

export async function saveFiscalStart(month: number): Promise<void> {
  if (!Number.isInteger(month) || month < 0 || month > 11) throw new Error('Invalid month.');
  const db = await database();
  await db.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
    fiscalStartKey,
    String(month),
  ]);
}

/**
 * The Accounts, their change in each calendar month up to today, and the lending entries.
 * For one Account, lending is empty, because a lending entry has no link to an Account.
 */
export async function netWorthData(
  accountId: number | null,
  today: number,
): Promise<NetWorthInput> {
  const db = await database();
  const [accounts, changes, lending, rate] = await Promise.all([
    db.getAllAsync<NetWorthInput['accounts'][number] & { isFavorite: number }>(
      `SELECT id, name, currencyCode, openingBalanceMinor, isFavorite FROM accounts
      ${accountId === null ? '' : 'WHERE id = ?'} ORDER BY name, id`,
      accountId === null ? [] : [accountId],
    ),
    db.getAllAsync<NetWorthInput['changes'][number]>(
      `SELECT a.id AS accountId,
      CAST(strftime('%Y', t.date * 86400, 'unixepoch') AS INTEGER) * 12
        + CAST(strftime('%m', t.date * 86400, 'unixepoch') AS INTEGER) - 1 AS month,
      SUM(CASE
        WHEN t.type = 'EXPENSE' THEN -t.amountMinor
        WHEN t.type = 'INCOME' THEN t.amountMinor
        WHEN t.type = 'TRANSFER' AND t.accountId = a.id THEN -t.amountMinor
        ELSE COALESCE(t.receivedAmountMinor, t.amountMinor) END) AS changeMinor
      FROM accounts a JOIN transactions t
        ON t.accountId = a.id OR (t.type = 'TRANSFER' AND t.transferAccountId = a.id)
      WHERE t.date <= ? GROUP BY a.id, month`,
      [today],
    ),
    accountId === null
      ? db.getAllAsync<NetWorthInput['lending'][number]>(
          `SELECT e.personId, e.kind, COALESCE(a.currencyCode, e.currencyCode) AS currencyCode,
          COALESCE(t.amountMinor, e.amountMinor) AS amountMinor, COALESCE(t.date, e.date) AS date
          FROM lending_entries e LEFT JOIN transactions t ON t.id = e.transactionId
          LEFT JOIN accounts a ON a.id = t.accountId WHERE COALESCE(t.date, e.date) <= ?`,
          [today],
        )
      : Promise.resolve([]),
    getDisplayRate(),
  ]);
  const favorite = accounts.find((account) => account.isFavorite) ?? accounts[0];
  return {
    accounts: accounts.map(({ isFavorite: _, ...account }) => account),
    changes,
    lending,
    rate,
    mainCurrency: favorite?.currencyCode ?? defaultCurrencyCode,
    today,
  };
}
