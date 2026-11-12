import type { SQLiteDatabase } from 'expo-sqlite';
import { database } from './database';
import { addTransactionTags, parseQuickAddTags } from './tag-store';

export type LendingKind =
  'LEND' | 'BORROW' | 'RECEIVE_REPAYMENT' | 'REPAY' | 'WRITE_OFF_LENT' | 'WRITE_OFF_BORROWED';
export type Person = { id: number; name: string };
export type LendingInput = {
  id?: number;
  personId: number;
  kind: LendingKind;
  amountMinor: number;
  date: number;
  note?: string | null;
  accountId?: number;
  currencyCode?: string;
  confirmOverpayment?: boolean;
  tagText?: string;
};
export type LendingEntry = {
  id: number;
  personId: number;
  personName: string;
  kind: LendingKind;
  transactionId: number | null;
  currencyCode: string;
  amountMinor: number;
  date: number;
  note: string | null;
  accountId: number | null;
  accountName: string | null;
};
export type LendingTotal = {
  personId: number;
  currencyCode: string;
  direction: 'LENT' | 'BORROWED';
  principalMinor: number;
  repaidMinor: number;
  writtenOffMinor: number;
  outstandingMinor: number;
  overpaidMinor: number;
};
export type LendingResult =
  | { status: 'saved'; id: number }
  | { status: 'deleted' }
  | { status: 'confirmation_required'; warnings: LendingTotal[] };
type DB = Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync' | 'runAsync'>;
const kinds: LendingKind[] = [
  'LEND',
  'BORROW',
  'RECEIVE_REPAYMENT',
  'REPAY',
  'WRITE_OFF_LENT',
  'WRITE_OFF_BORROWED',
];
const writeoff = (kind: LendingKind) => kind === 'WRITE_OFF_LENT' || kind === 'WRITE_OFF_BORROWED';
const expense = (kind: LendingKind) => kind === 'LEND' || kind === 'REPAY';
function positive(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('Enter a positive integer amount or ID.');
}
export async function createPerson(name: string): Promise<Person> {
  name = name.trim();
  if (!name) throw new Error('Enter a person name.');
  const db = await database();
  const result = await db.runAsync('INSERT INTO people (name) VALUES (?)', [name]);
  return { id: result.lastInsertRowId, name };
}
export async function listPeople(): Promise<Person[]> {
  return (await database()).getAllAsync<Person>(
    'SELECT id, name FROM people ORDER BY name COLLATE NOCASE, id',
  );
}
async function entries(db: DB, personId?: number): Promise<LendingEntry[]> {
  return db.getAllAsync<LendingEntry>(
    `SELECT e.id,e.personId,p.name AS personName,e.kind,e.transactionId,
 CASE WHEN t.id IS NULL THEN e.currencyCode ELSE a.currencyCode END AS currencyCode,
 COALESCE(t.amountMinor,e.amountMinor) AS amountMinor,COALESCE(t.date,e.date) AS date,
 CASE WHEN t.id IS NULL THEN e.note ELSE t.note END AS note,t.accountId,a.name AS accountName
 FROM lending_entries e JOIN people p ON p.id=e.personId LEFT JOIN transactions t ON t.id=e.transactionId LEFT JOIN accounts a ON a.id=t.accountId
 ${personId === undefined ? '' : 'WHERE e.personId = ?'} ORDER BY date DESC,e.id DESC`,
    personId === undefined ? [] : [personId],
  );
}
export async function listLendingEntries(personId?: number) {
  return entries(await database(), personId);
}
function totals(rows: LendingEntry[]): LendingTotal[] {
  const map = new Map<string, LendingTotal>();
  for (const row of rows) {
    const direction = ['LEND', 'RECEIVE_REPAYMENT', 'WRITE_OFF_LENT'].includes(row.kind)
      ? 'LENT'
      : 'BORROWED';
    const key = `${row.personId}:${row.currencyCode}:${direction}`;
    const total = map.get(key) ?? {
      personId: row.personId,
      currencyCode: row.currencyCode,
      direction,
      principalMinor: 0,
      repaidMinor: 0,
      writtenOffMinor: 0,
      outstandingMinor: 0,
      overpaidMinor: 0,
    };
    if (row.kind === 'LEND' || row.kind === 'BORROW') total.principalMinor += row.amountMinor;
    else if (writeoff(row.kind)) total.writtenOffMinor += row.amountMinor;
    else total.repaidMinor += row.amountMinor;
    const balance = total.principalMinor - total.repaidMinor - total.writtenOffMinor;
    total.outstandingMinor = Math.max(0, balance);
    total.overpaidMinor = Math.max(0, -balance);
    if (
      ![total.principalMinor, total.repaidMinor, total.writtenOffMinor].every(Number.isSafeInteger)
    )
      throw new Error('Lending total exceeds supported range.');
    map.set(key, total);
  }
  return [...map.values()].sort(
    (a, b) =>
      a.personId - b.personId ||
      a.currencyCode.localeCompare(b.currencyCode) ||
      a.direction.localeCompare(b.direction),
  );
}
export async function listLendingTotals(personId?: number) {
  return totals(await listLendingEntries(personId));
}
function warnings(before: LendingEntry[], after: LendingEntry[]) {
  const old = totals(before);
  return totals(after).filter(
    (t) =>
      t.overpaidMinor >
      (old.find(
        (o) =>
          o.personId === t.personId &&
          o.currencyCode === t.currencyCode &&
          o.direction === t.direction,
      )?.overpaidMinor ?? 0),
  );
}
async function person(db: DB, id: number) {
  positive(id);
  if (!(await db.getFirstAsync('SELECT id FROM people WHERE id=?', [id])))
    throw new Error('Person not found.');
}
export async function saveLendingEntry(input: LendingInput): Promise<LendingResult> {
  const tags = input.tagText?.trim() ? parseQuickAddTags(input.tagText) : [];
  if (tags.length && writeoff(input.kind))
    throw new Error('Write-offs cannot have transaction tags.');
  positive(input.amountMinor);
  if (!kinds.includes(input.kind)) throw new Error('Invalid lending kind.');
  if (!Number.isSafeInteger(input.date) || input.date < 0) throw new Error('Choose a valid date.');
  const db = await database();
  let result: LendingResult = { status: 'deleted' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    await person(tx, input.personId);
    const before = await entries(tx);
    const original = input.id === undefined ? undefined : before.find((e) => e.id === input.id);
    if (input.id !== undefined && !original) throw new Error('Entry not found.');
    if (original && writeoff(original.kind) !== writeoff(input.kind))
      throw new Error('Cannot convert a money movement into a write-off.');
    let currencyCode = input.currencyCode?.trim().toUpperCase();
    if (!writeoff(input.kind)) {
      positive(input.accountId ?? 0);
      const account = await tx.getFirstAsync<{ currencyCode: string }>(
        'SELECT currencyCode FROM accounts WHERE id=?',
        [input.accountId!],
      );
      if (!account) throw new Error('Account not found.');
      currencyCode = account.currencyCode;
    } else if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode))
      throw new Error('Choose a currency.');
    const row: LendingEntry = {
      id: input.id ?? -1,
      personId: input.personId,
      personName: '',
      kind: input.kind,
      transactionId: original?.transactionId ?? null,
      currencyCode: currencyCode!,
      amountMinor: input.amountMinor,
      date: input.date,
      note: input.note?.trim() || null,
      accountId: input.accountId ?? null,
      accountName: null,
    };
    const warning = warnings(before, [...before.filter((e) => e.id !== row.id), row]);
    if (warning.length && !input.confirmOverpayment) {
      result = { status: 'confirmation_required', warnings: warning };
      return;
    }
    let transactionId = original?.transactionId ?? null;
    if (!writeoff(input.kind)) {
      if (transactionId !== null)
        await tx.runAsync(
          'UPDATE transactions SET type=?,amountMinor=?,date=?,accountId=?,note=?,excludeFromReport=1 WHERE id=?',
          [
            expense(input.kind) ? 'EXPENSE' : 'INCOME',
            row.amountMinor,
            row.date,
            row.accountId,
            row.note,
            transactionId,
          ],
        );
      else {
        const r = await tx.runAsync(
          'INSERT INTO transactions (type,amountMinor,date,accountId,note,excludeFromReport) VALUES (?,?,?,?,?,1)',
          [
            expense(input.kind) ? 'EXPENSE' : 'INCOME',
            row.amountMinor,
            row.date,
            row.accountId,
            row.note,
          ],
        );
        transactionId = r.lastInsertRowId;
      }
    }
    if (transactionId !== null && input.tagText !== undefined) {
      await tx.runAsync('DELETE FROM transaction_tags WHERE transactionId=?', [transactionId]);
      await addTransactionTags(tx, transactionId, tags);
    }
    const values = [
      row.personId,
      row.kind,
      transactionId,
      row.currencyCode,
      row.amountMinor,
      row.date,
      row.note,
    ];
    if (original) {
      await tx.runAsync(
        'UPDATE lending_entries SET personId=?,kind=?,transactionId=?,currencyCode=?,amountMinor=?,date=?,note=? WHERE id=?',
        [...values, original.id],
      );
      result = { status: 'saved', id: original.id };
    } else {
      const r = await tx.runAsync(
        'INSERT INTO lending_entries (personId,kind,transactionId,currencyCode,amountMinor,date,note) VALUES (?,?,?,?,?,?,?)',
        values,
      );
      result = { status: 'saved', id: r.lastInsertRowId };
    }
  });
  return result;
}
export async function deleteLendingEntry(
  id: number,
  options: { confirmDelete?: boolean; confirmOverpayment?: boolean } = {},
): Promise<LendingResult> {
  positive(id);
  if (!options.confirmDelete) throw new Error('Confirm deletion first.');
  const db = await database();
  let result: LendingResult = { status: 'deleted' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const before = await entries(tx);
    const row = before.find((e) => e.id === id);
    if (!row) throw new Error('Entry not found.');
    const warning = warnings(
      before,
      before.filter((e) => e.id !== id),
    );
    if (warning.length && !options.confirmOverpayment) {
      result = { status: 'confirmation_required', warnings: warning };
      return;
    }
    await tx.runAsync('DELETE FROM lending_entries WHERE id=?', [id]);
    if (row.transactionId !== null)
      await tx.runAsync('DELETE FROM transactions WHERE id=?', [row.transactionId]);
  });
  return result;
}
export type UnassignedLendingTransaction = {
  transactionId: number;
  kind: Exclude<LendingKind, 'WRITE_OFF_LENT' | 'WRITE_OFF_BORROWED'>;
  amountMinor: number;
  date: number;
  accountId: number;
  accountName: string;
  currencyCode: string;
  categoryName: string;
  note: string | null;
};
async function unassigned(db: DB) {
  return db.getAllAsync<UnassignedLendingTransaction>(
    `SELECT t.id AS transactionId, CASE WHEN t.type='EXPENSE' AND c.name='Loan' COLLATE NOCASE THEN 'LEND' WHEN t.type='EXPENSE' THEN 'REPAY' WHEN c.name='Debt' COLLATE NOCASE THEN 'BORROW' ELSE 'RECEIVE_REPAYMENT' END AS kind,t.amountMinor,t.date,t.accountId,a.name AS accountName,a.currencyCode,c.name AS categoryName,t.note FROM transactions t JOIN accounts a ON a.id=t.accountId JOIN categories c ON c.id=t.categoryId LEFT JOIN lending_entries e ON e.transactionId=t.id WHERE e.id IS NULL AND t.source='IMPORT' AND ((t.type='EXPENSE' AND (c.name='Loan' COLLATE NOCASE OR c.name='Repayment' COLLATE NOCASE)) OR (t.type='INCOME' AND (c.name='Debt Collection' COLLATE NOCASE OR c.name='Debt' COLLATE NOCASE))) ORDER BY t.date DESC,t.id DESC`,
  );
}
export async function listUnassignedLendingTransactions() {
  return unassigned(await database());
}
export async function assignLendingTransaction(
  transactionId: number,
  personId: number,
  options: { confirmOverpayment?: boolean } = {},
): Promise<LendingResult> {
  positive(transactionId);
  const db = await database();
  let result: LendingResult = { status: 'deleted' };
  await db.withExclusiveTransactionAsync(async (tx) => {
    await person(tx, personId);
    const row = (await unassigned(tx)).find((t) => t.transactionId === transactionId);
    if (!row) throw new Error('Transaction is not an unassigned historical lending movement.');
    const before = await entries(tx);
    const entry: LendingEntry = { ...row, id: -1, personId, personName: '' };
    const warning = warnings(before, [...before, entry]);
    if (warning.length && !options.confirmOverpayment) {
      result = { status: 'confirmation_required', warnings: warning };
      return;
    }
    const r = await tx.runAsync(
      'INSERT INTO lending_entries (personId,kind,transactionId,currencyCode,amountMinor,date,note) VALUES (?,?,?,?,?,?,?)',
      [personId, row.kind, transactionId, row.currencyCode, row.amountMinor, row.date, row.note],
    );
    await tx.runAsync('UPDATE transactions SET excludeFromReport=1 WHERE id=?', [transactionId]);
    await tx.runAsync(
      'UPDATE transfer_candidates SET resolved=1 WHERE outgoingTxnId=? OR incomingTxnId=?',
      [transactionId, transactionId],
    );
    result = { status: 'saved', id: r.lastInsertRowId };
  });
  return result;
}
