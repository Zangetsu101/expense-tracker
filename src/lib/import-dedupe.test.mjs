import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasAmbiguousLegacyImport, importRowKeys } from './import-dedupe.ts';

const row = { sourceId: '1', note: '', amount: -12.5, amountMinor: -1250, category: 'Food', account: 'Cash', currency: 'BDT', date: '2025-01-01', excludeFromReport: false };

test('overlapping exports identify rows independently of order and source ID', () => {
  const other = { ...row, amount: -20, amountMinor: -2000 };
  assert.deepEqual(importRowKeys([row, other]), [importRowKeys([other, { ...row, sourceId: '99' }])[1], importRowKeys([other])[0]]);
});

test('unkeyed legacy overlap cannot distinguish an old row from another identical occurrence', () => {
  const legacy = { date: Date.UTC(2025, 0, 1) / 86400000, account: 'cash', currency: 'BDT',
    category: 'Food', amountMinor: 1250, type: 'EXPENSE', note: null, excludeFromReport: 0 };
  assert.equal(hasAmbiguousLegacyImport([row, row], [legacy]), true);
  assert.equal(hasAmbiguousLegacyImport([{ ...row, amount: -20, amountMinor: -2000 }], [legacy]), false);
  assert.equal(hasAmbiguousLegacyImport([row], [{ ...legacy, category: null }]), true);
  assert.equal(hasAmbiguousLegacyImport([{ ...row, amount: -20, amountMinor: -2000 }], [{ ...legacy, category: null }]), false);
  assert.equal(hasAmbiguousLegacyImport([row], []), false);
});

test('row keys keep the ADR 0002 format built from the parsed amount', () => {
  const pay = { sourceId: '1', note: 'Pay', amount: 624.05, amountMinor: 62405, category: 'Salary', account: 'Remittance', currency: 'USD', date: '2026-06-01', excludeFromReport: false };
  assert.deepEqual(importRowKeys([pay]), ['["[\\"2026-06-01\\",\\"remittance\\",\\"USD\\",\\"salary\\",624.05,\\"Pay\\",false]",0]']);
});

test('identical legitimate rows have distinct occurrence keys', () => {
  const keys = importRowKeys([row, row]);
  assert.notEqual(keys[0], keys[1]);
  assert.deepEqual(importRowKeys([row, row]), keys);
  assert.equal(importRowKeys([row])[0], keys[0]);
});
