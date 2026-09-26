import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatEpochDay, formatTransactionAmount } from './transaction-format.ts';

test('Expense and Income use consistent signs and unknown currency codes do not crash', () => {
  assert.match(formatTransactionAmount('EXPENSE', 1234, 'BDT'), /^−/);
  assert.match(formatTransactionAmount('INCOME', 1234, 'BDT'), /^\+/);
  assert.ok(formatTransactionAmount('EXPENSE', 1234, 'NOT-A-CURRENCY').includes('NOT-A-CURRENCY'));
  assert.equal(formatEpochDay(20000), '2024-10-04');
});
