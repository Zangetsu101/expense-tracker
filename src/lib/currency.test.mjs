import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currencySymbol } from './currency.ts';

test('currencySymbol keeps each Currency apart', () => {
  assert.equal(currencySymbol('BDT'), '৳');
  assert.equal(currencySymbol('USD'), '$');
  assert.equal(currencySymbol('CAD'), 'CAD ', 'CAD does not share the $ of USD');
  assert.equal(currencySymbol('XYZ'), 'XYZ ');
});
