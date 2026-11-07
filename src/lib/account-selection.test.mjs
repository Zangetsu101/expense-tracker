import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAccountId, resolveHomeAccount } from './account-selection.ts';

const accounts = [
  { id: 1, name: 'Cash', currencyCode: 'BDT', isFavorite: 0 },
  { id: 2, name: 'Bank', currencyCode: 'BDT', isFavorite: 1 },
];

test('Home starts at the favorite, keeps explicit selections and recovers a missing Account', () => {
  assert.equal(resolveHomeAccount(accounts, undefined), 2);
  assert.equal(resolveHomeAccount(accounts, 1), 1);
  assert.equal(resolveHomeAccount(accounts, null), null);
  assert.equal(resolveHomeAccount(accounts, 99), 2);
  assert.equal(
    resolveHomeAccount(
      accounts.map((a) => ({ ...a, isFavorite: 0 })),
      undefined,
    ),
    null,
  );
  assert.equal(resolveHomeAccount([], undefined), null);
  assert.equal(
    resolveHomeAccount(
      accounts.map((a) => ({ ...a, isFavorite: a.id === 1 ? 1 : 0 })),
      undefined,
    ),
    1,
  );
});

test('Account route context accepts a single positive safe integer only', () => {
  assert.equal(parseAccountId('2'), 2);
  for (const value of [undefined, '', '0', '-1', '1.5', '1e2', '1abc', ['1'], '9007199254740992']) {
    assert.equal(parseAccountId(value), undefined);
  }
});
