import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importRowKeys } from './import-dedupe.ts';

const row = { sourceId: '1', note: '', amount: -12.5, category: 'Food', account: 'Cash', currency: 'BDT', date: '2025-01-01', excludeFromReport: false };

test('overlapping exports identify rows independently of order and source ID', () => {
  const other = { ...row, amount: -20 };
  assert.deepEqual(importRowKeys([row, other]), [importRowKeys([other, { ...row, sourceId: '99' }])[1], importRowKeys([other])[0]]);
});

test('identical legitimate rows have distinct occurrence keys', () => {
  const keys = importRowKeys([row, row]);
  assert.notEqual(keys[0], keys[1]);
  assert.deepEqual(importRowKeys([row, row]), keys);
  assert.equal(importRowKeys([row])[0], keys[0]);
});
