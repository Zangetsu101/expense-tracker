// Node test helpers that write Transactions to the legs schema from the row shape of the
// screens: a type, an amount and the Accounts. They use the same mapping as the v1 restore.
import type { DatabaseSync } from 'node:sqlite';

type LendingKind = 'LEND' | 'BORROW' | 'RECEIVE_REPAYMENT' | 'REPAY';
export type TestTransaction = {
  id?: number;
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amountMinor: number;
  date: number;
  accountId: number;
  transferAccountId?: number | null;
  receivedAmountMinor?: number | null;
  categoryId?: number | null;
  note?: string | null;
  excludeFromReport?: number | boolean;
  /** Makes a lending Transaction with this person. */
  lending?: { personId: number; kind: LendingKind };
  /** Makes a reimbursement of this Expense. */
  reimburses?: { expenseId: number; personId: number | null };
};

const currency = (sql: DatabaseSync, accountId: number) =>
  (
    sql.prepare('SELECT currencyCode FROM accounts WHERE id = ?').get(accountId) as
      { currencyCode: string } | undefined
  )?.currencyCode ?? 'BDT';

function insertLeg(
  sql: DatabaseSync,
  transactionId: number,
  target: { accountId: number } | { personId: number },
  currencyCode: string,
  amountMinor: number,
) {
  sql
    .prepare(
      'INSERT INTO legs (transactionId, accountId, personId, currencyCode, amountMinor) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      transactionId,
      'accountId' in target ? target.accountId : null,
      'personId' in target ? target.personId : null,
      currencyCode,
      amountMinor,
    );
}

/** Saves one Transaction with its legs, and its reimbursement row. Returns its id. */
export function addTransaction(sql: DatabaseSync, row: TestTransaction): number {
  let kind: string = row.type;
  if (row.lending) kind = 'LENDING';
  else if (row.reimburses) kind = 'REIMBURSEMENT';
  let direction: string | null = null;
  if (row.lending)
    direction = ['LEND', 'RECEIVE_REPAYMENT'].includes(row.lending.kind) ? 'LENT' : 'BORROWED';
  const reportable = kind === 'EXPENSE' || kind === 'INCOME' || kind === 'REIMBURSEMENT';
  const result = sql
    .prepare(
      'INSERT INTO transactions (id, kind, direction, date, categoryId, note, excludeFromReport) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      row.id ?? null,
      kind,
      direction,
      row.date,
      kind === 'EXPENSE' || kind === 'INCOME' ? (row.categoryId ?? null) : null,
      row.note ?? null,
      reportable && row.excludeFromReport ? 1 : 0,
    );
  const id = Number(result.lastInsertRowid);
  const source = currency(sql, row.accountId);
  const signed = row.type === 'INCOME' ? row.amountMinor : -row.amountMinor;
  insertLeg(sql, id, { accountId: row.accountId }, source, signed);
  if (row.type === 'TRANSFER')
    insertLeg(
      sql,
      id,
      { accountId: row.transferAccountId! },
      currency(sql, row.transferAccountId!),
      row.receivedAmountMinor ?? row.amountMinor,
    );
  if (row.lending) insertLeg(sql, id, { personId: row.lending.personId }, source, -signed);
  if (row.reimburses)
    sql
      .prepare('INSERT INTO reimbursements (transactionId, expenseId, personId) VALUES (?, ?, ?)')
      .run(id, row.reimburses.expenseId, row.reimburses.personId);
  return id;
}

/** Saves a Write-off. Returns its id. */
export function addWriteOff(
  sql: DatabaseSync,
  row: {
    id?: number;
    personId: number;
    direction: 'LENT' | 'BORROWED';
    currencyCode: string;
    amountMinor: number;
    date: number;
    note?: string | null;
  },
): number {
  const result = sql
    .prepare(
      "INSERT INTO transactions (id, kind, direction, date, note) VALUES (?, 'WRITE_OFF', ?, ?, ?)",
    )
    .run(row.id ?? null, row.direction, row.date, row.note ?? null);
  const id = Number(result.lastInsertRowid);
  const amount = row.direction === 'LENT' ? -row.amountMinor : row.amountMinor;
  insertLeg(sql, id, { personId: row.personId }, row.currencyCode, amount);
  return id;
}
