import { defaultCurrencyCode } from '@/lib/currency';
import { database, isFavoriteSql } from '@/lib/database';
import { lendingEntryRows } from '@/lib/ledger-store';
import { investmentBalances } from '@/lib/investments';
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
 * For one Account, lending is empty, so the chart shows only that Account.
 */
export async function netWorthData(
  accountId: number | null,
  today: number,
): Promise<NetWorthInput> {
  const db = await database();
  const accountsRead = db
    .getAllAsync<NetWorthInput['accounts'][number] & { isFavorite: number }>(
      `SELECT a.id, a.name, a.currencyCode, a.openingBalanceMinor, ${isFavoriteSql('a')} AS isFavorite,
      CASE WHEN EXISTS (SELECT 1 FROM investments WHERE accountId = a.id) THEN 'investment'
        WHEN EXISTS (SELECT 1 FROM credit_cards WHERE accountId = a.id) THEN 'card'
        ELSE 'liquid' END AS kind
      FROM accounts a ${accountId === null ? '' : 'WHERE a.id = ?'} ORDER BY a.name, a.id`,
      accountId === null ? [] : [accountId],
    )
    .then(async (accounts) => ({
      accounts,
      investments: accounts.some(({ kind }) => kind === 'investment')
        ? await investmentBalances(today)
        : [],
    }));
  const [{ accounts, investments }, changes, lending, rate] = await Promise.all([
    accountsRead,
    db.getAllAsync<NetWorthInput['changes'][number]>(
      `SELECT l.accountId,
      CAST(strftime('%Y', t.date * 86400, 'unixepoch') AS INTEGER) * 12
        + CAST(strftime('%m', t.date * 86400, 'unixepoch') AS INTEGER) - 1 AS month,
      SUM(l.amountMinor) AS changeMinor
      FROM legs l JOIN transactions t ON t.id = l.transactionId
      WHERE l.accountId IS NOT NULL AND t.date <= ? GROUP BY l.accountId, month`,
      [today],
    ),
    accountId === null
      ? db.getAllAsync<NetWorthInput['lending'][number]>(
          `SELECT personId, kind, currencyCode, amountMinor, date FROM (${lendingEntryRows})
          WHERE date <= ?`,
          [today],
        )
      : Promise.resolve([]),
    getDisplayRate(),
  ]);
  const favorite = accounts.find((account) => account.isFavorite) ?? accounts[0];
  return {
    accounts: accounts.map(({ isFavorite: _, ...account }) => ({
      ...account,
      investment: investments.find(({ id }) => id === account.id),
    })),
    changes,
    lending,
    rate,
    mainCurrency: favorite?.currencyCode ?? defaultCurrencyCode,
    today,
  };
}
