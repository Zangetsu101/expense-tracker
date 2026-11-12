import type { SQLiteDatabase } from 'expo-sqlite';
import { database, epochDay } from './database';
import { addTransactionTags, parseQuickAddTags } from './tag-store';

export type EditableTransfer = {
  id: number;
  type: 'TRANSFER';
  amountMinor: number;
  date: number;
  fromAccountId: number;
  fromAccountName: string;
  toAccountId: number;
  toAccountName: string;
  currencyCode: string;
  note: string | null;
};

type TransferInput = {
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

async function requireSameCurrency(tx: Pick<SQLiteDatabase, 'getAllAsync'>, input: TransferInput) {
  const accounts = await tx.getAllAsync<{ id: number; currencyCode: string }>(
    'SELECT id, currencyCode FROM accounts WHERE id IN (?, ?)',
    [input.fromAccountId, input.toAccountId],
  );
  if (accounts.length !== 2) throw new Error('Account not found.');
  if (accounts[0].currencyCode !== accounts[1].currencyCode)
    throw new Error('Transfers require accounts with the same currency.');
}

export async function addTransfer(input: TransferInput & { date?: Date; tagText?: string }) {
  const date = input.date ?? new Date();
  if (!Number.isFinite(date.getTime()) || epochDay(date) > epochDay(new Date()))
    throw new Error('Choose today or a past date.');
  const tags = input.tagText?.trim() ? parseQuickAddTags(input.tagText) : [];
  validateTransfer(input);
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await requireSameCurrency(tx, input);
    const result = await tx.runAsync(
      `INSERT INTO transactions (type, amountMinor, date, accountId, transferAccountId, categoryId, note)
      VALUES ('TRANSFER', ?, ?, ?, ?, NULL, ?)`,
      [
        input.amountMinor,
        epochDay(date),
        input.fromAccountId,
        input.toAccountId,
        input.note?.trim() || null,
      ],
    );
    await addTransactionTags(tx, result.lastInsertRowId, tags);
  });
}

export async function loadTransfer(id: number): Promise<EditableTransfer | null> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid transaction ID.');
  const db = await database();
  return db.getFirstAsync<EditableTransfer>(
    `SELECT t.id, t.type, t.amountMinor, t.date, t.accountId AS fromAccountId, f.name AS fromAccountName,
    t.transferAccountId AS toAccountId, d.name AS toAccountName, f.currencyCode, t.note
    FROM transactions t JOIN accounts f ON f.id = t.accountId JOIN accounts d ON d.id = t.transferAccountId
    WHERE t.id = ? AND t.type = 'TRANSFER'`,
    [id],
  );
}

export async function saveTransferEdit(
  original: EditableTransfer,
  input: TransferInput & { date: number },
) {
  validateTransfer(input);
  if (!Number.isSafeInteger(input.date) || input.date < 0) throw new Error('Choose a valid date.');
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await requireSameCurrency(tx, input);
    const result = await tx.runAsync(
      `UPDATE transactions SET amountMinor = ?, date = ?, accountId = ?, transferAccountId = ?, note = ?
      WHERE id = ? AND type = 'TRANSFER' AND amountMinor = ? AND date = ? AND accountId = ? AND transferAccountId = ? AND note IS ?`,
      [
        input.amountMinor,
        input.date,
        input.fromAccountId,
        input.toAccountId,
        input.note?.trim() || null,
        original.id,
        original.amountMinor,
        original.date,
        original.fromAccountId,
        original.toAccountId,
        original.note,
      ],
    );
    if (result.changes !== 1)
      throw new Error('Transaction was changed or removed. Reload before saving.');
  });
}
