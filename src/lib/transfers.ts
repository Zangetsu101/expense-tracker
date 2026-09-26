import { database, epochDay } from './database';

export function transferAmountMinor(value: string): number {
  const match = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error('Enter a positive amount with at most two decimal places.');
  const [whole] = value.trim().split('.');
  const minor = Number(whole) * 100 + Number((match[1] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error('Enter a positive amount within the supported range.');
  return minor;
}

export async function addTransfer(input: { amountMinor: number; fromAccountId: number; toAccountId: number; note: string | null }) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('Enter a positive amount.');
  if (!Number.isSafeInteger(input.fromAccountId) || !Number.isSafeInteger(input.toAccountId) || input.fromAccountId <= 0 || input.toAccountId <= 0 || input.fromAccountId === input.toAccountId) {
    throw new Error('Select two different accounts.');
  }
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const accounts = await tx.getAllAsync<{ id: number; currencyCode: string }>(
      'SELECT id, currencyCode FROM accounts WHERE id IN (?, ?)', [input.fromAccountId, input.toAccountId]);
    if (accounts.length !== 2) throw new Error('Account not found.');
    if (accounts[0].currencyCode !== accounts[1].currencyCode) throw new Error('Transfers require accounts with the same currency.');
    await tx.runAsync(`INSERT INTO transactions (type, amountMinor, date, accountId, transferAccountId, categoryId, note)
      VALUES ('TRANSFER', ?, ?, ?, ?, NULL, ?)`,
      [input.amountMinor, epochDay(new Date()), input.fromAccountId, input.toAccountId, input.note?.trim() || null]);
  });
}
