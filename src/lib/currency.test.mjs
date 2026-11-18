import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byMainCurrency, currencySymbol } from './currency.ts';

test('currencySymbol keeps each Currency apart', () => {
  assert.equal(currencySymbol('BDT'), '৳');
  assert.equal(currencySymbol('USD'), '$');
  assert.equal(currencySymbol('CAD'), 'CAD ', 'CAD does not share the $ of USD');
  assert.equal(currencySymbol('XYZ'), 'XYZ ');
});

test('byMainCurrency puts the main Currency first and the others in code order', () => {
  assert.deepEqual(['USD', 'EUR', 'BDT'].sort(byMainCurrency('USD')), ['USD', 'BDT', 'EUR']);
});
