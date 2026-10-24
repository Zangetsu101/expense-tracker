import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countLabel, formatEpochDay, formatTransactionAmount } from './transaction-format.ts';

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
