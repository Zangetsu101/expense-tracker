import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeBalances, parseAccountId, resolveHomeAccount, watchHomeReopen } from './account-selection.ts';

const accounts = [
  { id: 1, name: 'Cash', currencyCode: 'BDT', isFavorite: 0 },
  { id: 2, name: 'Bank', currencyCode: 'BDT', isFavorite: 1 },
];

test('Home starts at the favorite, keeps explicit selections and recovers a missing Account', () => {
  assert.equal(resolveHomeAccount(accounts, undefined), 2);
  assert.equal(resolveHomeAccount(accounts, 1), 1);
  assert.equal(resolveHomeAccount(accounts, null), null);
  assert.equal(resolveHomeAccount(accounts, 99), 2);
  assert.equal(resolveHomeAccount(accounts.map((a) => ({ ...a, isFavorite: 0 })), undefined), null);
  assert.equal(resolveHomeAccount([], undefined), null);
  assert.equal(resolveHomeAccount(accounts.map((a) => ({ ...a, isFavorite: a.id === 1 ? 1 : 0 })), undefined), 1);
});

test('Account route context accepts a single positive safe integer only', () => {
  assert.equal(parseAccountId('2'), 2);
  for (const value of [undefined, '', '0', '-1', '1.5', '1e2', '1abc', ['1'], '9007199254740992']) {
    assert.equal(parseAccountId(value), undefined);
  }
});


test('Reopening resets to favorite, while tab focus and transient inactivity keep the selection', () => {
  let listener;
  let removed = false;
  let selected = 1;
  let resets = 0;
  const stop = watchHomeReopen({
    currentState: 'active',
    addEventListener: (_, callback) => { listener = callback; return { remove: () => { removed = true; } }; },
  }, () => { selected = resolveHomeAccount(accounts, undefined); resets++; });
  listener('active');
  listener('inactive');
  listener('active');
  assert.equal(selected, 1);
  assert.equal(resets, 0);
  listener('inactive');
  listener('background');
  listener('inactive');
  listener('active');
  assert.equal(selected, 2);
  assert.equal(resets, 1);
  selected = null;
  listener('background');
  listener('active');
  assert.equal(selected, 2);
  assert.equal(resets, 2);
  stop();
  assert.equal(removed, true);
});

test('homeBalances scopes to the selected account', () => {
  const rows = [{ id: 1, currencyCode: 'BDT', balanceMinor: 500 }, { id: 2, currencyCode: 'BDT', balanceMinor: -200 }, { id: 3, currencyCode: 'USD', balanceMinor: 100 }];
  assert.deepEqual(homeBalances(rows, 2), [{ currencyCode: 'BDT', balanceMinor: -200 }]);
  assert.deepEqual(homeBalances(rows, null), [{ currencyCode: 'BDT', balanceMinor: 300 }, { currencyCode: 'USD', balanceMinor: 100 }]);
  assert.deepEqual(homeBalances(rows, 9), []);
});
