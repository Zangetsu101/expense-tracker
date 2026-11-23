import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitShares } from './reimbursements.ts';

test('splits evenly in minor units and redistributes around fixed shares', () => {
  assert.deepEqual(splitShares(100, [1, 2], {}), {
    shares: [
      { personId: 1, amountMinor: 34 },
      { personId: 2, amountMinor: 33 },
    ],
    yours: 33,
  });
  assert.deepEqual(splitShares(2, [1, 2, 3], {}), {
    shares: [
      { personId: 1, amountMinor: 1 },
      { personId: 2, amountMinor: 1 },
      { personId: 3, amountMinor: 0 },
    ],
    yours: 0,
  });
  assert.deepEqual(splitShares(101, [1], {}), {
    shares: [{ personId: 1, amountMinor: 51 }],
    yours: 50,
  });
  assert.deepEqual(splitShares(300000, [1, 2], { 1: 150000 }), {
    shares: [
      { personId: 1, amountMinor: 150000 },
      { personId: 2, amountMinor: 75000 },
    ],
    yours: 75000,
  });
  assert.deepEqual(splitShares(100, [1, 2], { 1: 150 }), {
    shares: [
      { personId: 1, amountMinor: 150 },
      { personId: 2, amountMinor: 0 },
    ],
    yours: -50,
  });
});
