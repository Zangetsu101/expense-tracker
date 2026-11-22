import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatLineItemAmount, parseLineItemAmount } from './line-item-amount.ts';

test('Line Item amounts preserve signed, zero and safe-integer minor units', () => {
  for (const amount of [-125, 0, 1234, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
    assert.equal(parseLineItemAmount(formatLineItemAmount(amount)), amount);
  }
  assert.equal(parseLineItemAmount('+0.01'), 1);
  for (const invalid of ['1.234', 'NaN', '', '90071992547410'])
    assert.throws(() => parseLineItemAmount(invalid));
});
