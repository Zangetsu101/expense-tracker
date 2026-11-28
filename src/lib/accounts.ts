import type { CreditCardSettings } from './credit-cards';
import { notifyDataChanged } from './data-changes.ts';
import { database, isFavoriteSql, setFavoriteAccount } from './database';

export type ManagedAccount = {
  id: number;
  name: string;
  currencyCode: string;
  openingBalanceMinor: number;
  isFavorite: number;
  isInvestment?: number;
  card?: CreditCardSettings;
};

export function reverseAmountSign(value: string): string {
  const amount = value.trim();
  return amount.startsWith('-') ? amount.slice(1) : `-${amount.replace(/^\+/, '')}`;
}

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
  const db = await database();
  const [cards, accounts] = await Promise.all([
    db.getAllAsync<CreditCardSettings>('SELECT * FROM credit_cards'),
    db.getAllAsync<ManagedAccount>(
      `SELECT a.id, a.name, a.currencyCode, a.openingBalanceMinor, ${isFavoriteSql('a')} AS isFavorite,
      EXISTS (SELECT 1 FROM investments WHERE accountId = a.id) AS isInvestment
      FROM accounts a ORDER BY isFavorite DESC, a.name COLLATE NOCASE, a.id`,
    ),
  ]);
  return accounts.map((account) => ({
    ...account,
    card: cards.find((card) => card.accountId === account.id),
  }));
}

export type AccountInput = {
  name: string;
  currencyCode: string;
  openingBalance: string;
  isCreditCard?: boolean;
  isInvestment?: boolean;
  parentAccountId?: number | null;
  statementDay?: number | null;
  dueDay?: number | null;
};

export async function createAccount(input: AccountInput): Promise<void> {
  return saveAccount(input);
}

export async function updateAccount(id: number, input: AccountInput): Promise<void> {
  return saveAccount(input, id);
}

async function saveAccount(input: AccountInput, id?: number): Promise<void> {
  if (input.isCreditCard && input.isInvestment) throw new Error('Choose one Account kind.');
  const name = input.name.trim();
  const currencyCode = input.currencyCode.trim().toUpperCase();
  if (!name || name.length > 100) throw new Error('Enter an account name (up to 100 characters).');
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error('Enter a three-letter currency code.');
  const openingBalanceMinor = parseOpeningBalance(input.openingBalance);
  for (const day of [input.statementDay, input.dueDay])
    if (day != null && (!Number.isInteger(day) || day < 1 || day > 31))
      throw new Error('Statement and due days must be between 1 and 31.');
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (id !== undefined) {
      const old = await tx.getFirstAsync<{ currencyCode: string; isCreditCard: number }>(
        `SELECT a.currencyCode, EXISTS (SELECT 1 FROM credit_cards WHERE accountId = a.id) AS isCreditCard
        FROM accounts a WHERE a.id = ?`,
        [id],
      );
      if (!old) throw new Error('Account not found.');
      if (old.currencyCode !== currencyCode) throw new Error('Currency cannot be changed.');
      if (input.isInvestment && old.isCreditCard)
        throw new Error('Change this Credit Card to a regular Account first.');
    }
    const existing = await tx.getFirstAsync(
      'SELECT 1 FROM accounts WHERE name = ? COLLATE NOCASE AND id != ?',
      [name, id ?? -1],
    );
    if (existing) throw new Error('An Account with this name already exists.');
    if (input.isCreditCard || input.isInvestment) {
      const child = await tx.getFirstAsync('SELECT 1 FROM credit_cards WHERE parentAccountId = ?', [
        id ?? -1,
      ]);
      if (child)
        throw new Error('Change the cards that pay from this Account before converting it.');
      if (input.isCreditCard && input.parentAccountId != null) {
        const parent = await tx.getFirstAsync<{ currencyCode: string }>(
          'SELECT currencyCode FROM accounts WHERE id = ? AND id NOT IN (SELECT accountId FROM credit_cards) AND id NOT IN (SELECT accountId FROM investments)',
          [input.parentAccountId],
        );
        if (!parent || input.parentAccountId === id)
          throw new Error('Choose a different liquid Account.');
      }
    }
    let accountId = id;
    if (accountId === undefined) {
      const result = await tx.runAsync(
        'INSERT INTO accounts (name, currencyCode, openingBalanceMinor) VALUES (?, ?, ?)',
        [name, currencyCode, openingBalanceMinor],
      );
      accountId = result.lastInsertRowId;
    } else {
      await tx.runAsync('UPDATE accounts SET name = ?, openingBalanceMinor = ? WHERE id = ?', [
        name,
        openingBalanceMinor,
        accountId,
      ]);
    }
    if (!input.isInvestment)
      await tx.runAsync('DELETE FROM investments WHERE accountId = ?', [accountId]);
    if (input.isCreditCard)
      await tx.runAsync(
        'INSERT OR REPLACE INTO credit_cards (accountId, parentAccountId, statementDay, dueDay) VALUES (?, ?, ?, ?)',
        [
          accountId,
          input.parentAccountId ?? null,
          input.statementDay ?? null,
          input.dueDay ?? null,
        ],
      );
    else await tx.runAsync('DELETE FROM credit_cards WHERE accountId = ?', [accountId]);
    if (input.isInvestment)
      await tx.runAsync('INSERT OR IGNORE INTO investments (accountId) VALUES (?)', [accountId]);
  });
  notifyDataChanged();
}

export { setFavoriteAccount };
