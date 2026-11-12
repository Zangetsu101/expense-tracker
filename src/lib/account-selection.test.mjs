import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountParams, parseAccountId } from './account-selection.ts';

test('Account route context accepts a single positive safe integer only', () => {
  assert.equal(parseAccountId('2'), 2);
  for (const value of [undefined, '', '0', '-1', '1.5', '1e2', '1abc', ['1'], '9007199254740992']) {
    assert.equal(parseAccountId(value), undefined);
  }
});

test('accountParams names an Account, or nothing for All accounts', () => {
  assert.deepEqual(accountParams(7), { accountId: '7' });
  assert.deepEqual(accountParams(null), {});
});
