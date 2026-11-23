import { notifyDataChanged, type SavedTransaction } from './data-changes.ts';
import type { SQLiteDatabase } from 'expo-sqlite';
import { database } from './database';
import { addTransactionTags, parseQuickAddTags } from './tag-store';
import { lendingTotals, type LendingTotal } from './lending-totals.ts';
import { insertTransaction, lendingEntryRows, updateTransaction } from './ledger-store.ts';
import type { LendingAction, NewTransaction } from './ledger.ts';

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
/** A lending Transaction or a Write-off. The id is the id of the Transaction. */
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
/** A Write-off has no Account. The Receipt shows it with "No Account movement". */
export type WriteOffEntry = LendingEntry & {
  type: 'WRITE_OFF';
  kind: 'WRITE_OFF_LENT' | 'WRITE_OFF_BORROWED';
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
function positive(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('Enter a positive integer amount or ID.');
}
/** When `id` is given, the row uses it. An ID that is in use makes the call fail. */
export async function createPerson(name: string, id?: number): Promise<Person> {
  name = name.trim();
  if (!name) throw new Error('Enter a person name.');
  if (id !== undefined) positive(id);
  const db = await database();
  const result = await db.runAsync('INSERT INTO people (id, name) VALUES (?, ?)', [
    id ?? null,
    name,
  ]);
  notifyDataChanged();
  return { id: result.lastInsertRowId, name };
}
export async function renamePerson(id: number, name: string): Promise<Person> {
  positive(id);
  name = name.trim();
  if (!name) throw new Error('Enter a person name.');
  const db = await database();
  const result = await db.runAsync('UPDATE people SET name=? WHERE id=?', [name, id]);
  if (result.changes !== 1) throw new Error('Person not found.');
  notifyDataChanged();
  return { id, name };
}
export async function listPeople(): Promise<Person[]> {
  return (await database()).getAllAsync<Person>(
    'SELECT id, name FROM people ORDER BY name COLLATE NOCASE, id',
  );
}
async function entries(
  db: DB,
  filter?: { personId: number } | { entryId: number },
): Promise<LendingEntry[]> {
  const column = filter && ('personId' in filter ? 'person.personId' : 't.id');
  return db.getAllAsync<LendingEntry>(
    `${lendingEntryRows} ${column ? `AND ${column} = ?` : ''} ORDER BY t.date DESC, t.id DESC`,
    filter ? ['personId' in filter ? filter.personId : filter.entryId] : [],
  );
}
export async function listLendingEntries(personId?: number) {
  return entries(await database(), personId === undefined ? undefined : { personId });
}
export async function listLendingTotals(personId?: number) {
  return lendingTotals(await listLendingEntries(personId));
}
export async function loadLendingEntry(id: number) {
  const [entry] = await entries(await database(), { entryId: id });
  return entry;
}

export async function loadPersonLedger(id: number) {
  const db = await database();
  const [person, rows] = await Promise.all([
    db.getFirstAsync<Person>('SELECT id,name FROM people WHERE id=?', [id]),
    entries(db, { personId: id }),
  ]);
  if (!person) throw new Error('Person not found.');
  return { person, entries: rows, totals: lendingTotals(rows) };
}

export type PersonWithTotals = Person & { totals: LendingTotal[]; lastDate?: number };

export async function listPeopleWithLendingTotals(): Promise<PersonWithTotals[]> {
  const [people, rows] = await Promise.all([listPeople(), listLendingEntries()]);
  const grouped = new Map<number, LendingTotal[]>();
  for (const total of lendingTotals(rows)) {
    const group = grouped.get(total.personId) ?? [];
    group.push(total);
    grouped.set(total.personId, group);
  }
  const dates = new Map<number, number>();
  for (const row of rows) {
    if (!dates.has(row.personId)) dates.set(row.personId, row.date);
  }
  return people.map((person) => ({
    ...person,
    totals: grouped.get(person.id) ?? [],
    lastDate: dates.get(person.id),
  }));
}

export async function linkedAmountWarnings(db: DB, transactionId: number, amountMinor: number) {
  const link = await db.getFirstAsync<{ personId: number }>(
    "SELECT personId FROM legs WHERE transactionId = ? AND personId IS NOT NULL AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND kind = 'LENDING')",
    [transactionId, transactionId],
  );
  if (!link) return [];
  const rows = await entries(db, { personId: link.personId });
  const row = rows.find((entry) => entry.transactionId === transactionId);
  if (!row || row.amountMinor === amountMinor) return [];
  return warnings(
    rows,
    rows.map((entry) => (entry === row ? { ...entry, amountMinor } : entry)),
  );
}

function warnings(before: LendingEntry[], after: LendingEntry[]) {
  const old = lendingTotals(before);
  return lendingTotals(after).filter(
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
  let added: SavedTransaction | undefined;
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
    const transaction: NewTransaction = writeoff(row.kind)
      ? {
          kind: 'WRITE_OFF',
          direction: row.kind === 'WRITE_OFF_LENT' ? 'LENT' : 'BORROWED',
          personId: row.personId,
          currencyCode: row.currencyCode,
          amountMinor: row.amountMinor,
          date: row.date,
          note: row.note,
        }
      : {
          kind: 'LENDING',
          action: row.kind as LendingAction,
          accountId: row.accountId!,
          personId: row.personId,
          amountMinor: row.amountMinor,
          date: row.date,
          note: row.note,
        };
    let id: number;
    if (original) {
      id = original.id;
      await updateTransaction(tx, { ...transaction, id });
    } else {
      id = await insertTransaction(tx, transaction);
      if (!writeoff(row.kind)) added = { id, date: row.date, accountIds: [row.accountId!] };
    }
    if (!writeoff(row.kind) && input.tagText !== undefined) {
      await tx.runAsync('DELETE FROM transaction_tags WHERE transactionId=?', [id]);
      await addTransactionTags(tx, id, tags);
    }
    result = { status: 'saved', id };
  });
  if (!('warnings' in result)) notifyDataChanged(added);
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
    await tx.runAsync('DELETE FROM transactions WHERE id=?', [id]);
  });
  if (!('warnings' in result)) notifyDataChanged();
  return result;
}
