import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countLabel, formatEpochDay, formatTransactionAmount, transactionTitle } from './transaction-format.ts';

test('lending titles use kind and person ahead of category, including attributed imports', () => {
  for (const [lendingKind, type, expected] of [
    ['LEND', 'EXPENSE', 'Lent to Sam'],
    ['BORROW', 'INCOME', 'Borrowed from Sam'],
    ['RECEIVE_REPAYMENT', 'INCOME', 'Repayment from Sam'],
    ['REPAY', 'EXPENSE', 'Repaid to Sam'],
  ]) {
    for (const categoryName of [null, 'Loan']) {
      assert.equal(transactionTitle({ type, categoryName, lendingKind, personName: 'Sam' }), expected);
    }
  }
});

test('ordinary titles preserve categories and use readable uncategorized fallbacks', () => {
  assert.equal(transactionTitle({ type: 'EXPENSE', categoryName: null }), 'Expense');
  assert.equal(transactionTitle({ type: 'INCOME', categoryName: null }), 'Income');
  assert.equal(transactionTitle({ type: 'TRANSFER', categoryName: null }), 'Transfer');
  assert.equal(transactionTitle({ type: 'EXPENSE', categoryName: 'Food' }), 'Food');
  assert.equal(transactionTitle({ type: 'EXPENSE', categoryName: 'Lunch', categoryPath: 'Food › Lunch' }), 'Food › Lunch');
});

test('Expense and Income use consistent signs and unknown currency codes do not crash', () => {
  assert.match(formatTransactionAmount('EXPENSE', 1234, 'BDT'), /^−/);
  assert.match(formatTransactionAmount('INCOME', 1234, 'BDT'), /^\+/);
  assert.ok(formatTransactionAmount('EXPENSE', 1234, 'NOT-A-CURRENCY').includes('NOT-A-CURRENCY'));
  assert.equal(formatEpochDay(20000), '2024-10-04');
});

test('count labels are singular only for exactly one complete count', () => {
  assert.equal(countLabel(0, 'result', 'results'), '0 results');
  assert.equal(countLabel(1, 'result', 'results'), '1 result');
  assert.equal(countLabel(2, 'account', 'accounts'), '2 accounts');
  assert.equal(countLabel(1, 'result', 'results', true), '1+ results');
  assert.equal(countLabel(50, 'result', 'results', true), '50+ results');
});
