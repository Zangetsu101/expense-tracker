import { notifyDataChanged } from './data-changes.ts';
import type { SQLiteDatabase } from 'expo-sqlite';
import { database, epochDay } from './database';
import { addTransactionTags, parseQuickAddTags } from './tag-store';
import { accountTransactions, insertTransaction, updateTransaction } from './ledger-store.ts';

export type EditableTransfer = {
  id: number;
  type: 'TRANSFER';
  receivedAmountMinor: number | null;
  amountMinor: number;
  date: number;
  fromAccountId: number;
  fromAccountName: string;
  toAccountId: number;
  toAccountName: string;
  currencyCode: string;
  destinationCurrencyCode: string;
  note: string | null;
};

type TransferInput = {
  receivedAmountMinor?: number | null;
  amountMinor: number;
  fromAccountId: number;
  toAccountId: number;
  note: string | null;
};

function validateTransfer(input: TransferInput) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new Error('Enter a positive amount.');
  if (
    !Number.isSafeInteger(input.fromAccountId) ||
    !Number.isSafeInteger(input.toAccountId) ||
    input.fromAccountId <= 0 ||
    input.toAccountId <= 0 ||
    input.fromAccountId === input.toAccountId
  ) {
    throw new Error('Select two different accounts.');
  }
}

/** The two sides of a Transfer. A Transfer in one Currency receives the paid amount. */
function sides(input: TransferInput, received: number | null) {
  return {
    from: { accountId: input.fromAccountId, amountMinor: input.amountMinor },
    to: { accountId: input.toAccountId, amountMinor: received ?? input.amountMinor },
  };
}

async function transferAccounts(tx: Pick<SQLiteDatabase, 'getAllAsync'>, input: TransferInput) {
  const accounts = await tx.getAllAsync<{ id: number; currencyCode: string; isInvestment: number }>(
    `SELECT a.id, a.currencyCode, EXISTS (SELECT 1 FROM investments WHERE accountId = a.id) AS isInvestment
    FROM accounts a WHERE a.id IN (?, ?)`,
    [input.fromAccountId, input.toAccountId],
  );
  if (accounts.length !== 2) throw new Error('Account not found.');
  return accounts;
}

function receivedAmount(firstCurrency: string, secondCurrency: string, input: TransferInput) {
  if (firstCurrency === secondCurrency) return null;
  if (!Number.isSafeInteger(input.receivedAmountMinor) || (input.receivedAmountMinor ?? 0) <= 0)
    throw new Error('Enter a positive amount received.');
  return input.receivedAmountMinor!;
}

export async function addTransfer(input: TransferInput & { date?: Date; tagText?: string }) {
  const date = input.date ?? new Date();
  if (!Number.isFinite(date.getTime()) || epochDay(date) > epochDay(new Date()))
    throw new Error('Choose today or a past date.');
  const tags = input.tagText?.trim() ? parseQuickAddTags(input.tagText) : [];
  validateTransfer(input);
  const db = await database();
  let id = 0;
  let accountIds: number[] = [];
  await db.withExclusiveTransactionAsync(async (tx) => {
    const [first, second] = await transferAccounts(tx, input);
    const received = receivedAmount(first.currencyCode, second.currencyCode, input);
    id = await insertTransaction(tx, {
      kind: 'TRANSFER',
      date: epochDay(date),
      note: input.note?.trim() || null,
      ...sides(input, received),
    });
    const visible = new Set(
      [first, second].filter((account) => !account.isInvestment).map(({ id }) => id),
    );
    accountIds = [input.fromAccountId, input.toAccountId].filter((id) => visible.has(id));
    await addTransactionTags(tx, id, tags);
  });
  notifyDataChanged(accountIds.length ? { id, date: epochDay(date), accountIds } : undefined);
}

const transferRead = `SELECT t.id, t.type, t.amountMinor, t.receivedAmountMinor, t.date,
  t.accountId AS fromAccountId, f.name AS fromAccountName, t.transferAccountId AS toAccountId,
  d.name AS toAccountName, f.currencyCode, d.currencyCode AS destinationCurrencyCode, t.note
  FROM ${accountTransactions} t JOIN accounts f ON f.id = t.accountId
  JOIN accounts d ON d.id = t.transferAccountId
  WHERE t.id = ? AND t.type = 'TRANSFER'`;

export async function loadTransfer(id: number): Promise<EditableTransfer | null> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid transaction ID.');
  const db = await database();
  return db.getFirstAsync<EditableTransfer>(transferRead, [id]);
}

export async function saveTransferEdit(
  original: EditableTransfer,
  input: TransferInput & { date: number },
) {
  validateTransfer(input);
  if (!Number.isSafeInteger(input.date) || input.date < 0) throw new Error('Choose a valid date.');
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await tx.getFirstAsync<EditableTransfer>(transferRead, [original.id]);
    if (
      !current ||
      current.amountMinor !== original.amountMinor ||
      current.date !== original.date ||
      current.fromAccountId !== original.fromAccountId ||
      current.toAccountId !== original.toAccountId ||
      current.note !== original.note ||
      current.receivedAmountMinor !== (original.receivedAmountMinor ?? null)
    )
      throw new Error('Transaction was changed or removed. Reload before saving.');
    const [first, second] = await transferAccounts(tx, input);
    const received = receivedAmount(first.currencyCode, second.currencyCode, input);
    await updateTransaction(tx, {
      id: original.id,
      kind: 'TRANSFER',
      date: input.date,
      note: input.note?.trim() || null,
      ...sides(input, received),
    });
  });
  notifyDataChanged();
}
