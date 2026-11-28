import { balanceAsOfSql } from './reports.ts';
import { database, epochDay } from '@/lib/database';
import { notifyDataChanged } from './data-changes.ts';
import { insertTransaction, loadTransaction, updateTransaction } from './ledger-store.ts';
import { convertTo, usableRate, type DisplayRate } from './display-rate.ts';

type CurrencyTotal = { currencyCode: string; amountMinor: number };
export type InvestmentBalance = {
  id: number;
  currencyCode: string;
  investedMinor: number;
  growthMinor: number;
  dividends: CurrencyTotal[];
};

export async function investmentBalances(today: number): Promise<InvestmentBalance[]> {
  const db = await database();
  const [balances, dividends] = await Promise.all([
    db.getAllAsync<Omit<InvestmentBalance, 'dividends'>>(
      `SELECT a.id, a.currencyCode,
        a.openingBalanceMinor + COALESCE(SUM(CASE WHEN t.kind <> 'VALUATION' THEN l.amountMinor END), 0) AS investedMinor,
        COALESCE(SUM(CASE WHEN t.kind = 'VALUATION' THEN l.amountMinor END), 0) AS growthMinor
      FROM investments i JOIN accounts a ON a.id = i.accountId
      LEFT JOIN legs l ON l.accountId = a.id
      LEFT JOIN transactions t ON t.id = l.transactionId AND t.date <= ?
      GROUP BY a.id`,
      [today],
    ),
    db.getAllAsync<CurrencyTotal & { id: number }>(
      `SELECT d.investmentAccountId AS id, l.currencyCode, SUM(l.amountMinor) AS amountMinor
      FROM investment_dividends d JOIN transactions t ON t.id = d.transactionId
      JOIN legs l ON l.transactionId = t.id
      WHERE t.date <= ? GROUP BY d.investmentAccountId, l.currencyCode ORDER BY l.currencyCode`,
      [today],
    ),
  ]);
  return balances.map((balance) => ({
    ...balance,
    dividends: dividends
      .filter(({ id }) => id === balance.id)
      .map(({ currencyCode, amountMinor }) => ({ currencyCode, amountMinor })),
  }));
}

/** Uses the Display Rate if it covers every dividend. Otherwise returns totals by Currency. */
export function investmentReturnTotals(balance: InvestmentBalance, rate: DisplayRate | null) {
  const { currencyCode, dividends, growthMinor } = balance;
  const converted = convertTo(dividends, usableRate(rate), currencyCode);
  if (converted !== null) return [{ currencyCode, amountMinor: growthMinor + converted }];
  const inAccountCurrency = dividends.find((row) => row.currencyCode === currencyCode);
  return [
    { currencyCode, amountMinor: growthMinor + (inAccountCurrency?.amountMinor ?? 0) },
    ...dividends.filter((row) => row.currencyCode !== currencyCode),
  ];
}

export async function recordValuation(accountId: number, targetMinor: number, date: number) {
  if (!Number.isSafeInteger(targetMinor) || targetMinor < 0)
    throw new Error('Enter a value of zero or more.');
  if (!Number.isSafeInteger(date) || date > epochDay(new Date()))
    throw new Error('Choose today or a past date.');
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const account = await tx.getFirstAsync<{ balanceMinor: number }>(
      `SELECT ${balanceAsOfSql} AS balanceMinor
      FROM investments i JOIN accounts a ON a.id = i.accountId WHERE a.id = ?`,
      [date, accountId],
    );
    if (!account) throw new Error('Investment not found.');
    const amountMinor = targetMinor - account.balanceMinor;
    if (!Number.isSafeInteger(amountMinor)) throw new Error('Value change is too large.');
    if (amountMinor === 0) throw new Error('Enter a different value.');
    await insertTransaction(tx, { kind: 'VALUATION', accountId, date, amountMinor, note: null });
  });
  notifyDataChanged();
}

export async function loadValuation(id: number) {
  const db = await database();
  const transaction = await loadTransaction(db, id);
  if (transaction?.kind !== 'VALUATION') return null;
  const account = await db.getFirstAsync<{ accountName: string; currencyCode: string }>(
    'SELECT name AS accountName, currencyCode FROM accounts WHERE id = ?',
    [transaction.accountId],
  );
  return account ? { ...transaction, ...account, type: 'VALUATION' as const } : null;
}

export async function saveValuationEdit(id: number, originalMinor: number, amountMinor: number) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0)
    throw new Error('Enter a gain or loss other than zero.');
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const valuation = await loadTransaction(tx, id);
    if (valuation?.kind !== 'VALUATION' || valuation.amountMinor !== originalMinor)
      throw new Error('Valuation changed. Reload before saving.');
    await updateTransaction(tx, { ...valuation, amountMinor });
  });
  notifyDataChanged();
}

export async function lastDividendCategory() {
  return (await database()).getFirstAsync<{ categoryId: number | null }>(
    `SELECT t.categoryId FROM investment_dividends d JOIN transactions t ON t.id = d.transactionId
    ORDER BY t.id DESC LIMIT 1`,
  );
}

export type InvestmentHistoryRow = {
  id: number;
  kind: 'TRANSFER' | 'VALUATION' | 'INCOME';
  date: number;
  amountMinor: number;
  currencyCode: string;
  otherAccount: string | null;
};

export async function investmentHistory(accountId: number) {
  const db = await database();
  return db.getAllAsync<InvestmentHistoryRow>(
    `SELECT t.id AS id, t.kind, t.date AS date, l.amountMinor, l.currencyCode, a.name AS otherAccount
    FROM legs l JOIN transactions t ON t.id = l.transactionId
    LEFT JOIN legs other ON t.kind = 'TRANSFER' AND other.transactionId = t.id AND other.id <> l.id
    LEFT JOIN accounts a ON a.id = other.accountId
    WHERE l.accountId = ? AND t.kind IN ('TRANSFER', 'VALUATION')
    UNION ALL
    SELECT t.id, t.kind, t.date, l.amountMinor, l.currencyCode, a.name
    FROM investment_dividends d JOIN transactions t ON t.id = d.transactionId
    JOIN legs l ON l.transactionId = t.id JOIN accounts a ON a.id = l.accountId
    WHERE d.investmentAccountId = ?
    ORDER BY date DESC, id DESC`,
    [accountId, accountId],
  );
}
