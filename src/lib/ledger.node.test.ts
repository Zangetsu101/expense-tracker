import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LedgerShapeError,
  parseTransaction,
  toLegs,
  toTransactionRow,
  type LegRow,
  type NewTransaction,
  type TransactionRow,
} from './ledger.ts';

const currencies: Record<number, string> = { 1: 'BDT', 2: 'BDT', 3: 'USD' };
const currencyOf = (id: number) => currencies[id];
const row = (
  kind: TransactionRow['kind'],
  extra: Partial<TransactionRow> = {},
): TransactionRow => ({
  id: 7,
  kind,
  direction: null,
  date: 20000,
  categoryId: null,
  note: null,
  excludeFromReport: 0,
  ...extra,
});
const account = (accountId: number, amountMinor: number, currencyCode = currencyOf(accountId)) =>
  ({ transactionId: 7, accountId, personId: null, currencyCode, amountMinor }) as LegRow;
const person = (personId: number, amountMinor: number, currencyCode = 'BDT') =>
  ({ transactionId: 7, accountId: null, personId, currencyCode, amountMinor }) as LegRow;
const refund = { transactionId: 7, expenseId: 3, personId: null };
const common = { date: 20000, note: 'n' };

test('each kind of Transaction goes to rows and back without change', () => {
  const transactions: NewTransaction[] = [
    {
      ...common,
      kind: 'EXPENSE',
      accountId: 1,
      amountMinor: 500,
      categoryId: 4,
      excludeFromReport: true,
    },
    {
      ...common,
      kind: 'INCOME',
      accountId: 3,
      amountMinor: 900,
      categoryId: null,
      excludeFromReport: false,
    },
    {
      ...common,
      kind: 'TRANSFER',
      from: { accountId: 1, amountMinor: 12000 },
      to: { accountId: 3, amountMinor: 100 },
    },
    { ...common, kind: 'LENDING', action: 'LEND', accountId: 1, personId: 5, amountMinor: 300 },
    {
      ...common,
      kind: 'LENDING',
      action: 'RECEIVE_REPAYMENT',
      accountId: 1,
      personId: 5,
      amountMinor: 300,
    },
    { ...common, kind: 'LENDING', action: 'BORROW', accountId: 3, personId: 5, amountMinor: 300 },
    { ...common, kind: 'LENDING', action: 'REPAY', accountId: 3, personId: 5, amountMinor: 300 },
    {
      ...common,
      kind: 'WRITE_OFF',
      direction: 'LENT',
      personId: 5,
      currencyCode: 'EUR',
      amountMinor: 50,
    },
    {
      ...common,
      kind: 'WRITE_OFF',
      direction: 'BORROWED',
      personId: 5,
      currencyCode: 'EUR',
      amountMinor: 50,
    },
    {
      ...common,
      kind: 'REIMBURSEMENT',
      accountId: 2,
      amountMinor: 40,
      excludeFromReport: false,
      expenseId: 3,
      personId: 5,
    },
  ];
  for (const transaction of transactions) {
    const legs = toLegs(transaction, currencyOf).map(
      (leg) => ({ ...leg, transactionId: 7 }) as LegRow,
    );
    const reimbursement =
      transaction.kind === 'REIMBURSEMENT'
        ? { transactionId: 7, expenseId: transaction.expenseId, personId: transaction.personId }
        : undefined;
    const parsed = parseTransaction(
      { id: 7, ...toTransactionRow(transaction) },
      legs,
      reimbursement,
    );
    assert.deepEqual(parsed, { id: 7, ...transaction });
  }
});

test('lending legs have opposite signs and use the Currency of the Account', () => {
  assert.deepEqual(
    toLegs(
      { ...common, kind: 'LENDING', action: 'BORROW', accountId: 3, personId: 5, amountMinor: 300 },
      currencyOf,
    ),
    [
      { accountId: 3, personId: null, currencyCode: 'USD', amountMinor: 300 },
      { accountId: null, personId: 5, currencyCode: 'USD', amountMinor: -300 },
    ],
  );
  assert.equal(
    toTransactionRow({
      ...common,
      kind: 'LENDING',
      action: 'REPAY',
      accountId: 3,
      personId: 5,
      amountMinor: 1,
    }).direction,
    'BORROWED',
  );
});

test('parseTransaction rejects each broken rule', () => {
  const cases: [string, TransactionRow, LegRow[], typeof refund?][] = [
    ['a reimbursement row on an Expense', row('EXPENSE'), [account(1, -5)], refund],
    ['a reimbursement without its row', row('REIMBURSEMENT'), [account(1, 5)]],
    ['lending without a direction', row('LENDING'), [account(1, -5), person(1, 5)]],
    ['an Expense with a direction', row('EXPENSE', { direction: 'LENT' }), [account(1, -5)]],
    [
      'a Transfer with a Category',
      row('TRANSFER', { categoryId: 1 }),
      [account(1, -5), account(2, 5)],
    ],
    ['an Expense with two legs', row('EXPENSE'), [account(1, -5), account(2, -5)]],
    ['an Expense with a Person leg', row('EXPENSE'), [person(1, -5)]],
    ['an Expense that adds money', row('EXPENSE'), [account(1, 5)]],
    ['an Income that removes money', row('INCOME'), [account(1, -5)]],
    ['a Transfer with one leg', row('TRANSFER'), [account(1, -5)]],
    ['a Transfer with two sources', row('TRANSFER'), [account(1, -5), account(2, -5)]],
    ['a Transfer to the same Account', row('TRANSFER'), [account(1, -5), account(1, 5)]],
    [
      'a Transfer that changes the amount in one Currency',
      row('TRANSFER'),
      [account(1, -5), account(2, 6)],
    ],
    ['lending without a Person leg', row('LENDING', { direction: 'LENT' }), [account(1, -5)]],
    [
      'lending that does not balance',
      row('LENDING', { direction: 'LENT' }),
      [account(1, -5), person(1, 4)],
    ],
    [
      'lending in two Currencies',
      row('LENDING', { direction: 'LENT' }),
      [account(3, -5), person(1, 5, 'BDT')],
    ],
    [
      'a write-off with an Account leg',
      row('WRITE_OFF', { direction: 'LENT' }),
      [account(1, -5), person(1, 5)],
    ],
    [
      'a LENT write-off that adds to the debt',
      row('WRITE_OFF', { direction: 'LENT' }),
      [person(1, 5)],
    ],
    [
      'a BORROWED write-off that lowers the person leg',
      row('WRITE_OFF', { direction: 'BORROWED' }),
      [person(1, -5)],
    ],
    ['a reimbursement with no leg', row('REIMBURSEMENT'), [], refund],
    ['a reimbursement that removes money', row('REIMBURSEMENT'), [account(1, -5)], refund],
  ];
  for (const [name, transaction, legs, reimbursement] of cases)
    assert.throws(() => parseTransaction(transaction, legs, reimbursement), LedgerShapeError, name);
});
