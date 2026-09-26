import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decodeBackup, encodeBackup, restoreBackup } from './backup.ts';

const native = readFileSync(new URL('../../scripts/fixtures/native-shaped-backup-v1.json', import.meta.url), 'utf8');

test('native v1 backups without import keys remain readable', () => {
  const data = decodeBackup(native);
  assert.equal(data.moneyLoverImportRows, undefined);
  assert.equal(decodeBackup(encodeBackup(data)).moneyLoverImportRows, undefined);
});

test('import row keys survive a JSON roundtrip and restore', async () => {
  const original = decodeBackup(native);
  const transactionId = original.transactions[0].id;
  original.moneyLoverImportRows = [{ rowKey: 'moneylover:row:1', transactionId }];
  const json = encodeBackup(original);
  let replaced;
  const restored = await restoreBackup({ snapshot: async () => original, replace: async (data) => { replaced = data; } }, {
    pickJsonDocument: async () => 'content://backup', readText: async () => json,
  });
  assert.equal(restored, true);
  assert.deepEqual(replaced.moneyLoverImportRows, original.moneyLoverImportRows);
});

test('invalid import metadata never reaches the replacement boundary', async () => {
  const backup = decodeBackup(native);
  backup.moneyLoverImportRows = [{ rowKey: 'orphan', transactionId: -1 }];
  let replaced = false;
  await assert.rejects(() => restoreBackup({ replace: async () => { replaced = true; } }, {
    pickJsonDocument: async () => 'content://backup', readText: async () => JSON.stringify(backup),
  }), /Invalid backup moneyLoverImportRows/);
  assert.equal(replaced, false);
});
