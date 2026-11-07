import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePositiveAmountMinor } from './amount.ts';

test('amount parser accepts cents without rounding or unsafe integers', () => {
  assert.equal(parsePositiveAmountMinor(' 12.34 '), 1234);
  assert.equal(parsePositiveAmountMinor('0.01'), 1);
  assert.equal(parsePositiveAmountMinor('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  for (const value of ['', '0', '-1', '1.234', '1e2', 'NaN', '90071992547410']) {
    assert.throws(() => parsePositiveAmountMinor(value), /positive amount/);
  }
});
