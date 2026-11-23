import { notifyDataChanged, type SavedTransaction } from './data-changes.ts';
import type { SQLiteDatabase } from 'expo-sqlite';
import { database } from './database';
import { addTransactionTags, parseQuickAddTags } from './tag-store';
import { lendingTotals, type LendingTotal } from './lending-totals.ts';

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
/** A write-off has no Transaction. The Receipt shows it with "No Account movement". */
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
const expense = (kind: LendingKind) => kind === 'LEND' || kind === 'REPAY';
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
  const column = filter && ('personId' in filter ? 'personId' : 'id');
  return db.getAllAsync<LendingEntry>(
    `SELECT e.id,e.personId,p.name AS personName,e.kind,e.transactionId,
 CASE WHEN t.id IS NULL THEN e.currencyCode ELSE a.currencyCode END AS currencyCode,
 COALESCE(t.amountMinor,e.amountMinor) AS amountMinor,COALESCE(t.date,e.date) AS date,
 CASE WHEN t.id IS NULL THEN e.note ELSE t.note END AS note,t.accountId,a.name AS accountName
 FROM lending_entries e JOIN people p ON p.id=e.personId LEFT JOIN transactions t ON t.id=e.transactionId LEFT JOIN accounts a ON a.id=t.accountId
 ${column ? `WHERE e.${column} = ?` : ''} ORDER BY date DESC,e.id DESC`,
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
    'SELECT personId FROM lending_entries WHERE transactionId=?',
    [transactionId],
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
        added = { id: transactionId, date: row.date, accountIds: [row.accountId!] };
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
    await tx.runAsync('DELETE FROM lending_entries WHERE id=?', [id]);
    if (row.transactionId !== null)
      await tx.runAsync('DELETE FROM transactions WHERE id=?', [row.transactionId]);
  });
  if (!('warnings' in result)) notifyDataChanged();
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
function historicalEntry(row: UnassignedLendingTransaction, personId: number): LendingEntry {
  return { ...row, id: -1, personId, personName: '' };
}

export async function loadUnassignedLending() {
  const rows = await listUnassignedLendingTransactions();
  return { rows, totals: lendingTotals(rows.map((row) => historicalEntry(row, 0))) };
}

type AssignmentResult =
  | { status: 'saved'; ids: number[]; person: Person }
  | Extract<LendingResult, { status: 'confirmation_required' }>;

export async function assignLendingTransactions(
  transactionIds: readonly number[],
  target: number | string,
  options: { confirmOverpayment?: boolean } = {},
): Promise<AssignmentResult> {
  if (!transactionIds.length) throw new Error('Select at least one entry.');
  const ids = [...new Set(transactionIds)];
  ids.forEach(positive);
  if (typeof target === 'number') positive(target);
  else if (!target.trim()) throw new Error('Enter a person name.');
  const db = await database();
  let result!: AssignmentResult;
  await db.withExclusiveTransactionAsync(async (tx) => {
    let chosen =
      typeof target === 'number'
        ? await tx.getFirstAsync<Person>('SELECT id,name FROM people WHERE id=?', [target])
        : await tx.getFirstAsync<Person>(
            'SELECT id,name FROM people WHERE name=? COLLATE NOCASE ORDER BY id LIMIT 1',
            [target.trim()],
          );
    if (!chosen && typeof target === 'number') throw new Error('Person not found.');
    const available = new Map((await unassigned(tx)).map((row) => [row.transactionId, row]));
    const rows = ids.map((id) => {
      const row = available.get(id);
      if (!row) throw new Error('Transaction is not an unassigned historical lending movement.');
      return row;
    });
    const before = await entries(tx);
    const warning = warnings(before, [
      ...before,
      ...rows.map((row) => historicalEntry(row, chosen?.id ?? 0)),
    ]);
    if (warning.length && !options.confirmOverpayment) {
      result = { status: 'confirmation_required', warnings: warning };
      return;
    }
    if (!chosen) {
      const name = String(target).trim();
      const created = await tx.runAsync('INSERT INTO people (name) VALUES (?)', [name]);
      chosen = { id: created.lastInsertRowId, name };
    }
    const saved = [];
    for (const row of rows) {
      const id = row.transactionId;
      const r = await tx.runAsync(
        'INSERT INTO lending_entries (personId,kind,transactionId,currencyCode,amountMinor,date,note) VALUES (?,?,?,?,?,?,?)',
        [chosen.id, row.kind, id, row.currencyCode, row.amountMinor, row.date, row.note],
      );
      await tx.runAsync('UPDATE transactions SET excludeFromReport=1 WHERE id=?', [id]);
      await tx.runAsync(
        'UPDATE transfer_candidates SET resolved=1 WHERE outgoingTxnId=? OR incomingTxnId=?',
        [id, id],
      );
      saved.push(r.lastInsertRowId);
    }
    result = { status: 'saved', ids: saved, person: chosen };
  });
  if (result.status === 'saved') notifyDataChanged();
  return result;
}

export async function assignLendingTransaction(
  transactionId: number,
  personId: number,
  options: { confirmOverpayment?: boolean } = {},
): Promise<LendingResult> {
  const result = await assignLendingTransactions([transactionId], personId, options);
  return result.status === 'saved' ? { status: 'saved', id: result.ids[0] } : result;
}
