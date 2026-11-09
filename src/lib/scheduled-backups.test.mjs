import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

const backupSource = stripTypeScriptTypes(
  readFileSync(new URL('./backup.ts', import.meta.url), 'utf8'),
);
const backupUrl = `data:text/javascript;base64,${Buffer.from(backupSource).toString('base64')}`;
const { restoreBackup } = await import(backupUrl);
const source = stripTypeScriptTypes(
  readFileSync(new URL('./scheduled-backups.ts', import.meta.url), 'utf8').replace(
    "'./backup'",
    JSON.stringify(backupUrl),
  ),
);
const { createScheduledBackups, emptyBackupSchedule } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
const day = 86400000;
function setup() {
  let state = structuredClone(emptyBackupSchedule);
  let now = Date.UTC(2026, 10, 7, 12);
  const documents = new Map();
  const deleted = [];
  let serial = 0;
  let snapshots = 0;
  const deps = {
    load: async () => structuredClone(state),
    save: async (next) => {
      state = structuredClone(next);
    },
    snapshotJson: async () => {
      snapshots++;
      return '{"schemaVersion":1,"transactions":[]}';
    },
    create: async (folder) => `${folder}/file-${++serial}`,
    write: async (uri, text) => documents.set(uri, text),
    read: async (uri) => documents.get(uri),
    remove: async (uri) => {
      deleted.push(uri);
      documents.delete(uri);
    },
    now: () => now,
  };
  const backups = createScheduledBackups(deps);
  return {
    backups,
    deps,
    documents,
    deleted,
    state: () => state,
    snapshots: () => snapshots,
    advance: (amount) => (now += amount),
  };
}

test('enabling creates a full backup; daily and weekly checks wait until due', async () => {
  const s = setup();
  await s.backups.runDue();
  assert.equal(s.snapshots(), 0);
  await assert.rejects(s.backups.configure('daily'), /Choose a backup folder/);
  const initial = await s.backups.configure('daily', 'folder:one');
  assert.equal(initial.lastError, null);
  assert.equal(initial.files.length, 1);
  assert.equal(s.documents.get(initial.files[0].uri), '{"schemaVersion":1,"transactions":[]}');
  s.advance(day - 1);
  await s.backups.runDue();
  assert.equal(s.snapshots(), 1);
  s.advance(1);
  await s.backups.runDue();
  assert.equal(s.snapshots(), 2);
  await s.backups.configure('weekly');
  s.advance(7 * day - 1);
  await s.backups.runDue();
  assert.equal(s.snapshots(), 3);
  s.advance(1);
  await s.backups.runDue();
  assert.equal(s.snapshots(), 4);
});

test('concurrent foreground/background due checks produce one backup', async () => {
  const s = setup();
  await s.backups.configure('daily', 'folder:one');
  s.advance(day);
  const results = await Promise.all(Array.from({ length: 5 }, () => s.backups.runDue()));
  assert.equal(s.snapshots(), 2);
  assert.equal(s.documents.size, 2);
  assert.ok(results.every((state) => state.files.length === 2));
});

test('write failure and truncated read preserve previous success and every older backup', async () => {
  const s = setup();
  await s.backups.configure('daily', 'folder:one');
  const previous = s.state();
  s.advance(day);
  const write = s.deps.write;
  s.deps.write = async () => {
    throw new Error('Permission revoked');
  };
  const failed = await s.backups.runDue();
  assert.equal(failed.lastSuccess, previous.lastSuccess);
  assert.match(failed.lastError, /Permission revoked/);
  assert.deepEqual(failed.files, previous.files);
  assert.ok(s.documents.has(previous.files[0].uri));
  s.deps.write = async (uri) => write(uri, '{');
  assert.match((await s.backups.runDue()).lastError, /verification failed/);
  assert.equal(s.documents.size, 1);
  s.deps.write = write;
  const retried = await s.backups.runDue();
  assert.equal(retried.lastError, null);
  assert.ok(retried.lastSuccess > previous.lastSuccess);
  assert.equal(retried.files.length, 2);
});

test('retention deletes only tracked files after recording a new verified success', async () => {
  const s = setup();
  s.documents.set('folder:one/unrelated.json', 'user document');
  await s.backups.configure('daily', 'folder:one');
  const first = s.state().files[0].uri;
  for (let index = 0; index < 7; index++) {
    s.advance(day);
    await s.backups.runDue();
  }
  assert.equal(s.state().files.length, 7);
  assert.deepEqual(s.deleted, [first]);
  assert.equal(s.documents.get('folder:one/unrelated.json'), 'user document');
  const remove = s.deps.remove;
  s.deps.remove = async () => {
    assert.equal(s.state().files.length, 8, 'new backup ownership persisted before deletion');
    throw new Error('read-only');
  };
  s.advance(day);
  const cleanupFailure = await s.backups.runDue();
  assert.match(cleanupFailure.lastError, /Backup saved, but/);
  assert.equal(cleanupFailure.files.length, 8);
  s.deps.remove = remove;
  s.advance(day);
  assert.equal((await s.backups.runDue()).files.length, 7);
});

test('metadata save failure never deletes previous recovery points and the queue recovers', async () => {
  const s = setup();
  await s.backups.configure('daily', 'folder:one');
  const previous = s.state();
  const save = s.deps.save;
  s.deps.save = async () => {
    throw new Error('disk full');
  };
  s.advance(day);
  await assert.rejects(s.backups.runDue(), /disk full/);
  assert.deepEqual(s.state(), previous);
  assert.equal(s.deleted.length, 0);
  s.deps.save = save;
  assert.equal((await s.backups.runDue()).files.length, 2);
});

test('disable stops jobs without deleting files; new destinations leave previous files alone', async () => {
  const s = setup();
  await s.backups.configure('daily', 'folder:one');
  const first = s.state().files[0].uri;
  await s.backups.configure('off');
  s.advance(10 * day);
  await s.backups.runDue();
  assert.equal(s.snapshots(), 1);
  assert.ok(s.documents.has(first));
  await s.backups.configure('weekly');
  assert.equal(s.snapshots(), 2);
  await s.backups.configure('weekly', 'folder:two');
  assert.equal(s.state().files.length, 1);
  assert.ok(s.state().files[0].uri.startsWith('folder:two/'));
  assert.ok(s.documents.has(first));
  assert.equal(s.deleted.length, 0);
});

test('a clock moving backwards does not suppress backups indefinitely', async () => {
  const s = setup();
  await s.backups.configure('daily', 'folder:one');
  s.advance(-day);
  assert.equal((await s.backups.runDue()).files.length, 2);
});

test('manual restore and scheduled catch-up cannot overlap', async () => {
  const s = setup();
  await s.backups.configure('daily', 'folder:one');
  s.advance(day);
  let releaseRestore;
  let enterRestore;
  const restoring = new Promise((resolve) => {
    enterRestore = resolve;
  });
  let liveData = 'before restore';
  s.deps.snapshotJson = async () => liveData;
  const restore = restoreBackup(
    {
      replace: async () => {
        enterRestore();
        await new Promise((resolve) => {
          releaseRestore = resolve;
        });
        liveData = 'after restore';
      },
    },
    {
      pickJsonDocument: async () => ({ uri: 'manual-backup', name: 'backup.json' }),
      readText: async () => '{"schemaVersion":1}',
    },
    async () => true,
  );
  await restoring;
  const catchUp = s.backups.runDue();
  await Promise.resolve();
  assert.equal(s.documents.size, 1);
  releaseRestore();
  assert.equal(await restore, true);
  const result = await catchUp;
  assert.equal(s.documents.get(result.files.at(-1).uri), 'after restore');
});

test('manual saved-folder backups work while automatic scheduling is Off', async () => {
  const s = setup();
  await s.backups.configure('off', 'folder:one');
  assert.equal(s.snapshots(), 0);
  const result = await s.backups.runDue(true);
  assert.equal(result.interval, 'off');
  assert.equal(result.files.length, 1);
  assert.equal(result.lastError, null);
  assert.ok(result.lastSuccess !== null);
  await s.backups.runDue();
  assert.equal(s.snapshots(), 1);
});

test('changing settings keeps a failed backup visible until a verified recovery', async () => {
  const s = setup();
  await s.backups.configure('daily', 'folder:one');
  const write = s.deps.write;
  s.deps.write = async () => {
    throw new Error('Permission denied');
  };
  s.advance(day);
  const failed = await s.backups.runDue();
  const stopped = await s.backups.configure('off');
  assert.equal(stopped.lastError, failed.lastError);
  assert.equal(stopped.lastSuccess, failed.lastSuccess);
  const reconnected = await s.backups.configure('off', 'folder:two');
  assert.equal(reconnected.lastError, failed.lastError);
  assert.equal((await s.backups.runDue(true)).lastError, failed.lastError);
  s.deps.write = write;
  const recovered = await s.backups.runDue(true);
  assert.equal(recovered.lastError, null);
  assert.ok(recovered.lastSuccess > failed.lastSuccess);
  assert.equal(recovered.interval, 'off');
});

test('attempt identity changes only for actual backups, including repeated failures', async () => {
  const s = setup();
  const first = await s.backups.configure('daily', 'folder:one');
  assert.equal(first.attempt, 1);
  assert.equal((await s.backups.runDue()).attempt, 1);
  s.deps.write = async () => {
    throw Error('Permission revoked');
  };
  assert.equal((await s.backups.runDue(true)).attempt, 2);
  assert.equal((await s.backups.runDue(true)).attempt, 3);
  assert.equal((await s.backups.configure('off')).attempt, 3);
  assert.equal((await s.backups.runDue()).attempt, 3);
  const changedFolder = await s.backups.configure('off', 'folder:two');
  assert.equal(changedFolder.attempt, 3);
  assert.equal((await s.backups.runDue(true)).attempt, 4);
});
