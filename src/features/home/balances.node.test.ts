import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeBalances } from './balances.ts';

test('homeBalances scopes to the selected Account', () => {
  const rows = [
    { id: 1, currencyCode: 'BDT', balanceMinor: 500 },
    { id: 2, currencyCode: 'BDT', balanceMinor: -200 },
    { id: 3, currencyCode: 'USD', balanceMinor: 100 },
  ];
  assert.deepEqual(homeBalances(rows, 2), [{ currencyCode: 'BDT', balanceMinor: -200 }]);
  assert.deepEqual(homeBalances(rows, null), [
    { currencyCode: 'BDT', balanceMinor: 300 },
    { currencyCode: 'USD', balanceMinor: 100 },
  ]);
  assert.deepEqual(homeBalances(rows, 9), []);
});
