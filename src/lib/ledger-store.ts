// Reads and writes of Transactions in the legs schema. Every write goes through
// toTransactionRow() and toLegs(), so the rows always have the shape of their kind.
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  parseTransaction,
  toLegs,
  toTransactionRow,
  type LegRow,
  type NewTransaction,
  type ReimbursementRow,
  type Transaction,
  type TransactionRow,
} from './ledger.ts';

type Reader = Pick<SQLiteDatabase, 'getAllAsync' | 'getFirstAsync'>;
type Writer = Reader & Pick<SQLiteDatabase, 'runAsync'>;

/**
 * SQL for the old lending kind. It comes from the Direction and the signed amount of the
 * Account leg, which is null for a Write-off. It is null for other Transactions.
 */
export function lendingKindSql(direction: string, accountAmount: string) {
  return `CASE ${direction}
    WHEN 'LENT' THEN CASE WHEN ${accountAmount} IS NULL THEN 'WRITE_OFF_LENT'
      WHEN ${accountAmount} < 0 THEN 'LEND' ELSE 'RECEIVE_REPAYMENT' END
    WHEN 'BORROWED' THEN CASE WHEN ${accountAmount} IS NULL THEN 'WRITE_OFF_BORROWED'
      WHEN ${accountAmount} > 0 THEN 'BORROW' ELSE 'REPAY' END END`;
}

/**
 * SQL for a table with one row for each Transaction that moves money on an Account. A
 * Write-off has no row. The columns have the shapes that the screens use:
 *
 * - `type` is TRANSFER, or EXPENSE when money leaves the Account, or else INCOME.
 * - `amountMinor` and `accountId` come from the source leg, and `transferAccountId` from
 *   the destination leg of a Transfer.
 * - `receivedAmountMinor` is the destination amount of a Transfer between Currencies.
 * - `excludeFromReport` is 1 for lending, because lending is never in reports.
 * - `personId` and `lendingKind` are set for lending.
 */
export const accountTransactions = `(SELECT t.id, t.kind, t.date, t.categoryId, t.note,
  CASE WHEN t.kind = 'TRANSFER' THEN 'TRANSFER'
    WHEN source.amountMinor < 0 THEN 'EXPENSE' ELSE 'INCOME' END AS type,
  abs(source.amountMinor) AS amountMinor, source.accountId,
  destination.accountId AS transferAccountId,
  CASE WHEN destination.currencyCode <> source.currencyCode
    THEN destination.amountMinor END AS receivedAmountMinor,
  CASE WHEN t.kind = 'LENDING' THEN 1 ELSE t.excludeFromReport END AS excludeFromReport,
  person.personId, ${lendingKindSql('t.direction', 'source.amountMinor')} AS lendingKind
  FROM transactions t
  JOIN legs source ON source.transactionId = t.id AND source.accountId IS NOT NULL
    AND (t.kind <> 'TRANSFER' OR source.amountMinor < 0)
  LEFT JOIN legs destination ON t.kind = 'TRANSFER' AND destination.transactionId = t.id
    AND destination.amountMinor > 0
  LEFT JOIN legs person ON t.kind = 'LENDING' AND person.transactionId = t.id
    AND person.personId IS NOT NULL)`;

/**
 * SQL for the lending entries: one row for each lending Transaction and each Write-off.
 * The id of an entry is the id of its Transaction. `transactionId` is null for a
 * Write-off, which has no Account.
 */
export const lendingEntryRows = `SELECT t.id, person.personId, p.name AS personName,
  ${lendingKindSql('t.direction', 'account.amountMinor')} AS kind,
  CASE WHEN t.kind = 'LENDING' THEN t.id END AS transactionId, person.currencyCode,
  abs(person.amountMinor) AS amountMinor, t.date, t.note, account.accountId,
  a.name AS accountName
  FROM transactions t
  JOIN legs person ON person.transactionId = t.id AND person.personId IS NOT NULL
  JOIN people p ON p.id = person.personId
  LEFT JOIN legs account ON account.transactionId = t.id AND account.accountId IS NOT NULL
  LEFT JOIN accounts a ON a.id = account.accountId
  WHERE t.kind IN ('LENDING', 'WRITE_OFF')`;

function accountIdsOf(transaction: NewTransaction): number[] {
  switch (transaction.kind) {
    case 'TRANSFER':
      return [transaction.from.accountId, transaction.to.accountId];
    case 'WRITE_OFF':
      return [];
    default:
      return [transaction.accountId];
  }
}

/** The Currency of each Account of the Transaction. Throws if an Account is missing. */
async function currencies(tx: Reader, transaction: NewTransaction) {
  const ids = accountIdsOf(transaction);
  const rows = ids.length
    ? await tx.getAllAsync<{ id: number; currencyCode: string }>(
        `SELECT id, currencyCode FROM accounts WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ids,
      )
    : [];
  const map = new Map(rows.map((row) => [row.id, row.currencyCode]));
  if (ids.some((id) => !map.has(id))) throw new Error('Account not found.');
  return (id: number) => map.get(id)!;
}

const legOrder = 'ORDER BY personId IS NOT NULL, amountMinor, id';

async function insertLegs(tx: Writer, id: number, legs: ReturnType<typeof toLegs>) {
  for (const leg of legs)
    await tx.runAsync(
      'INSERT INTO legs (transactionId, accountId, personId, currencyCode, amountMinor) VALUES (?, ?, ?, ?, ?)',
      [id, leg.accountId, leg.personId, leg.currencyCode, leg.amountMinor],
    );
}

/** Saves a new Transaction with its legs, and returns its id. */
export async function insertTransaction(tx: Writer, transaction: NewTransaction): Promise<number> {
  const legs = toLegs(transaction, await currencies(tx, transaction));
  const row = toTransactionRow(transaction);
  const result = await tx.runAsync(
    'INSERT INTO transactions (kind, direction, date, categoryId, note, excludeFromReport) VALUES (?, ?, ?, ?, ?, ?)',
    [row.kind, row.direction, row.date, row.categoryId, row.note, row.excludeFromReport],
  );
  await insertLegs(tx, result.lastInsertRowId, legs);
  return result.lastInsertRowId;
}

/**
 * Saves a changed Transaction with its legs. When the old legs have the same targets, it
 * updates them in place, because a split or reimbursed Expense must keep its legs.
 */
export async function updateTransaction(tx: Writer, transaction: Transaction) {
  const legs = toLegs(transaction, await currencies(tx, transaction));
  const row = toTransactionRow(transaction);
  const result = await tx.runAsync(
    'UPDATE transactions SET kind = ?, direction = ?, date = ?, categoryId = ?, note = ?, excludeFromReport = ? WHERE id = ?',
    [
      row.kind,
      row.direction,
      row.date,
      row.categoryId,
      row.note,
      row.excludeFromReport,
      transaction.id,
    ],
  );
  if (result.changes !== 1)
    throw new Error('Transaction was changed or removed. Reload before saving.');
  const old = await tx.getAllAsync<{ id: number; personId: number | null }>(
    `SELECT id, personId FROM legs WHERE transactionId = ? ${legOrder}`,
    [transaction.id],
  );
  // toLegs() gives Account legs first, and the source before the destination.
  const same =
    old.length === legs.length &&
    old.every((leg, index) => (leg.personId === null) === (legs[index].personId === null));
  if (!same) {
    await tx.runAsync('DELETE FROM legs WHERE transactionId = ?', [transaction.id]);
    await insertLegs(tx, transaction.id, legs);
    return;
  }
  for (const [index, leg] of legs.entries())
    await tx.runAsync(
      'UPDATE legs SET accountId = ?, personId = ?, currencyCode = ?, amountMinor = ? WHERE id = ?',
      [leg.accountId, leg.personId, leg.currencyCode, leg.amountMinor, old[index].id],
    );
}

/** Reads one Transaction, or null if it does not exist. */
export async function loadTransaction(tx: Reader, id: number): Promise<Transaction | null> {
  const row = await tx.getFirstAsync<TransactionRow>(
    'SELECT id, kind, direction, date, categoryId, note, excludeFromReport FROM transactions WHERE id = ?',
    [id],
  );
  if (!row) return null;
  const [legs, reimbursement] = await Promise.all([
    tx.getAllAsync<LegRow>(
      `SELECT transactionId, accountId, personId, currencyCode, amountMinor FROM legs
      WHERE transactionId = ? ${legOrder}`,
      [id],
    ),
    tx.getFirstAsync<ReimbursementRow>(
      'SELECT transactionId, expenseId, personId FROM reimbursements WHERE transactionId = ?',
      [id],
    ),
  ]);
  return parseTransaction(row, legs, reimbursement ?? undefined);
}
