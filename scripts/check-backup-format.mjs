import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeBackup, encodeBackup } from '../src/lib/backup.ts';

const fixture = readFileSync(new URL('./fixtures/backup-v1.json', import.meta.url), 'utf8');
const data = decodeBackup(fixture);
assert.equal(data.schemaVersion, 1);
assert.equal(data.transactions[0].amountMinor, 1234);
assert.deepEqual(decodeBackup(encodeBackup(data)), data);
assert.throws(() => decodeBackup('{"schemaVersion":1,"accounts":[{"id":9007199254740993}]}'), /too large/);
assert.throws(() => decodeBackup('{"schemaVersion":2}'), /Unsupported/);
console.log('Backup JSON fixture and unsafe integer checks passed');
