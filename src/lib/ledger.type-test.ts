// Compile-time checks for ledger.ts. `pnpm typecheck` compiles this file. The line after
// each expect-error directive must fail to compile. If a change to the types lets one
// compile, tsc reports the unused directive. Prettier must keep each case on one line.

import type { LegRow, NewTransaction, Transaction } from './ledger.ts';

const common = { date: 20780, note: null };

// Valid Transactions of each kind.
// prettier-ignore
export const valid: NewTransaction[] = [
  { ...common, kind: 'EXPENSE', accountId: 1, amountMinor: 500, categoryId: 2, excludeFromReport: false },
  { ...common, kind: 'INCOME', accountId: 2, amountMinor: 8500000, categoryId: null, excludeFromReport: false },
  { ...common, kind: 'TRANSFER', from: { accountId: 2, amountMinor: 1200000 }, to: { accountId: 3, amountMinor: 10000 } },
  { ...common, kind: 'LENDING', action: 'REPAY', accountId: 1, personId: 1, amountMinor: 1000 },
  { ...common, kind: 'WRITE_OFF', direction: 'LENT', personId: 1, currencyCode: 'BDT', amountMinor: 600 },
  { ...common, kind: 'REIMBURSEMENT', accountId: 1, amountMinor: 40, excludeFromReport: false, expenseId: 9, personId: null },
];

// prettier-ignore
export const invalid: NewTransaction[] = [
  // @ts-expect-error A Transfer has no Category.
  { ...common, kind: 'TRANSFER', categoryId: 1, from: { accountId: 1, amountMinor: 1 }, to: { accountId: 2, amountMinor: 1 } },
  // @ts-expect-error A Transfer cannot be left out of reports.
  { ...common, kind: 'TRANSFER', excludeFromReport: true, from: { accountId: 1, amountMinor: 1 }, to: { accountId: 2, amountMinor: 1 } },
  // @ts-expect-error Lending needs a person.
  { ...common, kind: 'LENDING', action: 'LEND', accountId: 1, amountMinor: 1 },
  // @ts-expect-error Lending has no Category.
  { ...common, kind: 'LENDING', action: 'LEND', accountId: 1, personId: 1, amountMinor: 1, categoryId: 1 },
  // @ts-expect-error Lending stores the action; the direction comes from it.
  { ...common, kind: 'LENDING', direction: 'LENT', accountId: 1, personId: 1, amountMinor: 1 },
  // @ts-expect-error A write-off has no Account.
  { ...common, kind: 'WRITE_OFF', direction: 'LENT', personId: 1, accountId: 1, currencyCode: 'BDT', amountMinor: 1 },
  // @ts-expect-error A write-off needs a direction.
  { ...common, kind: 'WRITE_OFF', personId: 1, currencyCode: 'BDT', amountMinor: 1 },
  // @ts-expect-error An Expense has no direction.
  { ...common, kind: 'EXPENSE', direction: 'LENT', accountId: 1, amountMinor: 1, categoryId: null, excludeFromReport: false },
  // @ts-expect-error A reimbursement needs its Expense.
  { ...common, kind: 'REIMBURSEMENT', accountId: 1, amountMinor: 1, excludeFromReport: false, personId: null },
  // @ts-expect-error A reimbursement takes its Expense's Category.
  { ...common, kind: 'REIMBURSEMENT', accountId: 1, amountMinor: 1, excludeFromReport: false, expenseId: 9, personId: null, categoryId: 1 },
  // @ts-expect-error There is no such kind.
  { ...common, kind: 'REFUND', accountId: 1, amountMinor: 1 },
];

// prettier-ignore
export const legs: LegRow[] = [
  { transactionId: 1, accountId: 1, personId: null, currencyCode: 'BDT', amountMinor: -500 },
  { transactionId: 4, accountId: null, personId: 1, currencyCode: 'BDT', amountMinor: 300 },
  // @ts-expect-error A leg has one target, not two.
  { transactionId: 4, accountId: 1, personId: 1, currencyCode: 'BDT', amountMinor: 300 },
  // @ts-expect-error A leg needs a target.
  { transactionId: 4, accountId: null, personId: null, currencyCode: 'BDT', amountMinor: 300 },
];

// Narrowing on kind gives only that kind's fields.
export function describe(transaction: Transaction): string {
  switch (transaction.kind) {
    case 'TRANSFER':
      return `${transaction.from.accountId} → ${transaction.to.accountId}`;
    case 'LENDING':
      return transaction.action;
    case 'WRITE_OFF':
      return transaction.direction;
    default:
      // @ts-expect-error Only Transfers have `from`.
      return String(transaction.from);
  }
}
