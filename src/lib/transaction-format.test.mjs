import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countLabel, formatBalance, formatEpochDay, formatMoney, formatTransactionAmount, transactionTitle } from './transaction-format.ts';

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

test('activity dates use local calendar days across month and year boundaries', async () => {
  const { formatActivityDay } = await import('./transaction-format.ts');
  const now = new Date(2026, 0, 1, 0, 5);
  const today = Date.UTC(2026, 0, 1) / 86400000;
  assert.equal(formatActivityDay(today, now), 'Today');
  assert.equal(formatActivityDay(today - 1, now), 'Yesterday');
  assert.equal(formatActivityDay(today - 2, now), '2025-12-30');
  assert.equal(formatActivityDay(today + 1, now), '2026-01-02');
});

test('formatMoney writes Taka with the symbol and grouping', () => {
  assert.equal(formatMoney('EXPENSE', 245000, 'BDT'), '−৳2,450.00');
  assert.equal(formatMoney('INCOME', 5, 'BDT'), '+৳0.05');
  assert.equal(formatMoney('TRANSFER', 245000, 'BDT'), '৳2,450.00');
});

test('formatBalance signs negative balances only', () => {
  assert.equal(formatBalance(245000, 'BDT'), '৳2,450.00');
  assert.equal(formatBalance(-245000, 'BDT'), '−৳2,450.00');
  assert.equal(formatBalance(0, 'BDT'), '৳0.00');
  assert.equal(formatBalance(-150, 'USD'), `−${formatTransactionAmount('TRANSFER', 150, 'USD')}`);
});
