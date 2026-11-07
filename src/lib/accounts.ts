import { notifyDataChanged } from './data-changes.ts';
import { database, setFavoriteAccount } from './database';

export type ManagedAccount = {
  id: number;
  name: string;
  currencyCode: string;
  openingBalanceMinor: number;
  isFavorite: number;
};

export function parseOpeningBalance(value: string): number {
  const text = value.trim();
  if (!/^[+-]?(?:\d+)(?:\.\d{1,2})?$/.test(text))
    throw new Error('Enter an amount with at most two decimal places.');
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) throw new Error('Opening balance is too large.');
  return negative ? -minor : minor;
}

export async function listManagedAccounts(): Promise<ManagedAccount[]> {
  return (await database()).getAllAsync<ManagedAccount>(
    'SELECT id, name, currencyCode, openingBalanceMinor, isFavorite FROM accounts ORDER BY isFavorite DESC, name COLLATE NOCASE, id',
  );
}

export async function createAccount(input: {
  name: string;
  currencyCode: string;
  openingBalance: string;
}): Promise<void> {
  const name = input.name.trim();
  const currencyCode = input.currencyCode.trim().toUpperCase();
  if (!name || name.length > 100) throw new Error('Enter an account name (up to 100 characters).');
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error('Enter a three-letter currency code.');
  const openingBalanceMinor = parseOpeningBalance(input.openingBalance);
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const existing = await tx.getFirstAsync(
      'SELECT 1 FROM accounts WHERE name = ? COLLATE NOCASE',
      [name],
    );
    if (existing) throw new Error('An Account with this name already exists.');
    await tx.runAsync(
      'INSERT INTO accounts (name, currencyCode, openingBalanceMinor) VALUES (?, ?, ?)',
      [name, currencyCode, openingBalanceMinor],
    );
  });
  notifyDataChanged();
}

export { setFavoriteAccount };
