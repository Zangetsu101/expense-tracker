import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';

const source = stripTypeScriptTypes(
  readFileSync(new URL('./backup-presentation.ts', import.meta.url), 'utf8'),
);
const { backupFailureKind, backupFolderName, backupTime } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('recovery targets distinguish folder, space, interrupted saves, and retention', () => {
  for (const message of [
    'EACCES: access denied',
    'Permission revoked',
    "Location 'content://folder' isn't writable.",
    'Directory does not exist',
  ])
    assert.equal(backupFailureKind(message), 'folder');
  for (const message of ['ENOSPC', 'No space left on device', 'Disk full'])
    assert.equal(backupFailureKind(message), 'storage');
  for (const message of [
    'Backup verification failed.',
    'Write interrupted',
    'Unknown provider failure',
  ])
    assert.equal(backupFailureKind(message), 'save');
  assert.equal(
    backupFailureKind('Backup saved, but an older backup could not be removed. Permission denied'),
    'retention',
  );
});
test('folder labels use the last folder name and omit document-provider internals', () => {
  assert.equal(
    backupFolderName(
      'content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FExpense%20backups',
    ),
    'Expense backups',
  );
  assert.equal(
    backupFolderName('content://com.android.externalstorage.documents/tree/primary%3ABackups'),
    'Backups',
  );
});
test('backup times identify today, yesterday, and no previous backup', () => {
  const now = new Date(2026, 10, 8, 10, 0);
  assert.equal(backupTime(null, now), 'Never');
  assert.match(backupTime(new Date(2026, 10, 8, 9, 12).getTime(), now), /^Today at /);
  assert.match(backupTime(new Date(2026, 10, 7, 9, 12).getTime(), now), /^Yesterday at /);
});
