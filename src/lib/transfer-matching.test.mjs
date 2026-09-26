import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyTransferPairs } from './transfer-matching.ts';

const row = { sourceId: '1', note: '', amount: -50, category: 'Other Expense', account: 'Bank', currency: 'BDT', date: '2025-01-01', excludeFromReport: false };
const incoming = { ...row, sourceId: '2', amount: 50, category: 'Other Income', account: 'Cash' };

test('corroborated unique pair is safe to merge', () => {
  const out = { ...row, note: 'Send to Cash', category: 'Withdrawal' };
  assert.deepEqual(classifyTransferPairs([out, incoming]), {
    highConfidence: [{ outgoing: out, incoming }], uncertain: [], singleSided: [],
  });
});

test('multiple possible incoming legs never auto-merge even with a corroborated candidate', () => {
  const out = { ...row, category: 'Withdrawal', note: 'Send to Cash' };
  const other = { ...incoming, sourceId: '3', account: 'Savings' };
  assert.deepEqual(classifyTransferPairs([out, incoming, other]), {
    highConfidence: [],
    uncertain: [{ outgoing: out, incoming }, { outgoing: out, incoming: other }],
    singleSided: [out, incoming, other],
  });
});

test('multiple outgoing legs cannot claim the same incoming leg', () => {
  const out = { ...row, category: 'Withdrawal', note: 'Send to Cash' };
  const second = { ...out, sourceId: '3', account: 'Savings' };
  assert.equal(classifyTransferPairs([out, second, incoming]).highConfidence.length, 0);
  assert.equal(classifyTransferPairs([out, second, incoming]).uncertain.length, 2);
});

test('date, amount, sign, account and currency are all required', () => {
  const near = [
    { ...incoming, date: '2025-01-02' },
    { ...incoming, amount: 51 },
    { ...incoming, amount: -50 },
    { ...incoming, account: 'Bank' },
    { ...incoming, currency: 'USD' },
  ];
  for (const candidate of near) {
    assert.deepEqual(classifyTransferPairs([row, candidate]), {
      highConfidence: [], uncertain: [], singleSided: [row, candidate],
    });
  }
});

test('transfer word alone or a non-transfer category does not justify an auto-merge', () => {
  for (const out of [{ ...row, note: 'transfer' }, { ...row, note: 'Send to Cash' }, { ...row, category: 'Withdrawal fees' }]) {
    assert.deepEqual(classifyTransferPairs([out, incoming]).highConfidence, []);
  }
});

test('coincidental same-day amount remains a review candidate and both rows remain single-sided', () => {
  assert.deepEqual(classifyTransferPairs([row, incoming]), {
    highConfidence: [], uncertain: [{ outgoing: row, incoming }], singleSided: [row, incoming],
  });
});
