import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeBackup, encodeBackup } from '../src/lib/backup.ts';

const read = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const v1 = decodeBackup(read('backup-v1.json'));
assert.equal(v1.schemaVersion, 1);
assert.equal(v1.transactions[0].amountMinor, 1234);
assert.throws(() => encodeBackup(v1), /Unsupported backup schema version/);
assert.equal(decodeBackup(read('native-shaped-backup-v1.json')).schemaVersion, 1);

const v2 = decodeBackup(read('backup-v2.json'));
assert.equal(v2.schemaVersion, 2);
assert.equal(v2.legs[0].amountMinor, -1500);
assert.deepEqual(decodeBackup(encodeBackup(v2)), v2);

assert.throws(
  () => decodeBackup('{"schemaVersion":1,"accounts":[{"id":9007199254740993}]}'),
  /too large/,
);
assert.throws(() => decodeBackup('{"schemaVersion":4}'), /Unsupported/);
console.log('Backup JSON fixtures (v1 and v2) and unsafe integer checks passed');
