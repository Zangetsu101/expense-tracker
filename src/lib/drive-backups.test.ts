import { decodeBackup, restoreBackup } from './backup';
import {
  createDriveBackups,
  disconnectedState,
  DriveError,
  needsAttention,
  type ConnectedBackupState,
  type DriveBackupState,
  type DriveFolder,
} from './drive-backups';

const day = 24 * 60 * 60 * 1000;

function expectConnected(state: DriveBackupState): ConnectedBackupState {
  if (state.status !== 'connected') throw new Error('Expected a connected state.');
  return state;
}
const backupJson = (transactions = 0) =>
  JSON.stringify({
    schemaVersion: 1,
    transactions: Array.from({ length: transactions }, (_, id) => ({ id })),
  });

/** An in-memory Drive. Each account has its own folders, as `drive.file` access does. */
function fakeDrive(clock: () => number) {
  const files = new Map<
    string,
    { account: string; folderId: string; json: string; createdAt: number; transactions: number }
  >();
  const folders = new Map<string, string>();
  let serial = 0;
  let account = '';
  const deleted: string[] = [];
  const drive: DriveFolder = {
    async findOrCreateFolder() {
      const existing = folders.get(account);
      if (existing) return existing;
      const id = `folder-${++serial}`;
      folders.set(account, id);
      return id;
    },
    async list(folderId) {
      return [...files]
        .filter(([, file]) => file.folderId === folderId)
        .map(([id, file]) => ({
          id,
          createdAt: file.createdAt,
          size: file.json.length,
          transactions: file.transactions,
        }));
    },
    async upload(folderId, _name, json, transactions) {
      if (![...folders.values()].includes(folderId))
        throw new DriveError('notFound', 'File not found');
      const id = `file-${++serial}`;
      files.set(id, { account, folderId, json, createdAt: clock(), transactions });
      return { id, createdAt: clock() };
    },
    async download(id) {
      const file = files.get(id);
      if (!file) throw new DriveError('notFound', 'File not found');
      return file.json;
    },
    async remove(id) {
      deleted.push(id);
      files.delete(id);
    },
  };
  return {
    drive,
    files,
    folders,
    deleted,
    useAccount: (next: string) => {
      account = next;
    },
  };
}

function setup(email: string | null = 'you@example.com') {
  let state: DriveBackupState = structuredClone(disconnectedState);
  let now = Date.UTC(2026, 10, 7, 12);
  const google = fakeDrive(() => now);
  let liveJson = backupJson(2);
  let snapshots = 0;
  const replaced: unknown[] = [];
  const signIn = jest.fn(async () => {
    if (!email) return null;
    google.useAccount(email);
    return { email, photoUrl: `https://photos.example/${email}` };
  });
  const deps = {
    load: jest.fn(async () => structuredClone(state)),
    save: jest.fn(async (next: DriveBackupState) => {
      state = structuredClone(next);
    }),
    signIn,
    signOut: jest.fn(async () => {}),
    drive: google.drive,
    snapshot: async () => {
      snapshots++;
      return { json: liveJson, transactions: JSON.parse(liveJson).transactions.length };
    },
    replace: async (data: unknown) => {
      replaced.push(data);
    },
    now: () => now,
  };
  const backups = createDriveBackups(deps);
  return {
    backups,
    /** Runs a backup and expects the account to stay connected. */
    runDue: async (force?: boolean) => expectConnected(await backups.runDue(force)),
    deps,
    google,
    replaced,
    state: () => expectConnected(state),
    stored: () => state,
    snapshots: () => snapshots,
    advance: (amount: number) => (now += amount),
    now: () => now,
    setLive: (json: string) => (liveJson = json),
    signInAs: (next: string | null) => {
      email = next;
    },
  };
}

async function connected(s = setup()) {
  const result = await s.backups.connect();
  expect(result.kind).toBe('connected');
  return s;
}

describe('first connect', () => {
  test('an empty Drive turns on Daily and makes a verified backup at once', async () => {
    const s = setup();
    const result = await s.backups.connect();
    expect(result.kind).toBe('connected');
    expect(s.state()).toMatchObject({
      account: { email: 'you@example.com', photoUrl: 'https://photos.example/you@example.com' },
      interval: 'daily',
      status: 'connected',
      lastError: null,
      lastSuccess: s.now(),
    });
    expect(s.state().files).toHaveLength(1);
    expect(s.google.files.get(s.state().files[0].id)?.transactions).toBe(2);
  });

  test('cancelling the account chooser changes nothing', async () => {
    const s = setup(null);
    expect(await s.backups.connect()).toEqual({ kind: 'cancelled' });
    expect(s.stored()).toEqual(disconnectedState);
    expect(s.snapshots()).toBe(0);
  });

  test('when Drive already has backups, nothing runs until the user chooses', async () => {
    const s = await connected();
    s.advance(day);
    await s.backups.runDue();
    await s.backups.disconnect();

    // A new phone with no data connects to the same account.
    s.setLive(backupJson(0));
    s.advance(10 * day);
    const result = await s.backups.connect();
    expect(result.kind).toBe('backupsFound');
    expect(result.kind === 'backupsFound' && result.backups).toHaveLength(2);
    const waiting = s.stored();
    expect(waiting).toMatchObject({
      status: 'awaitingChoice',
      account: { email: 'you@example.com' },
    });

    s.advance(30 * day);
    expect(await s.backups.runDue()).toEqual(waiting);
    expect(await s.backups.runDue(true)).toEqual(waiting);
    await expect(s.backups.setInterval('daily')).rejects.toThrow('Choose what to do');
    expect(s.google.files.size).toBe(2);
    expect(needsAttention(waiting, s.now())).toBe(false);
  });

  test('restoring a found backup adopts the Drive backups and turns on Daily', async () => {
    const s = await connected();
    await s.backups.disconnect();
    const result = await s.backups.connect();
    if (result.kind !== 'backupsFound') throw new Error('expected backups');
    const [newest] = result.backups;

    const declined = await s.backups.restore(newest, async () => false);
    expect(declined).toBe(false);
    expect(s.replaced).toEqual([]);
    expect(s.stored().status).toBe('awaitingChoice');

    expect(await s.backups.restore(newest, async () => true)).toBe(true);
    expect(s.replaced).toEqual([decodeBackup(backupJson(2))]);
    expect(s.state()).toMatchObject({
      interval: 'daily',
      lastSuccess: newest.createdAt,
      files: [{ id: newest.id, createdAt: newest.createdAt }],
    });
  });

  test('keeping local data backs up now and retention counts the old Drive backups', async () => {
    const s = await connected();
    for (let index = 0; index < 6; index++) {
      s.advance(day);
      await s.backups.runDue();
    }
    const oldest = s.state().files[0].id;
    await s.backups.disconnect();
    expect(s.google.files.size).toBe(7);

    await s.backups.connect();
    s.advance(day);
    const kept = await s.backups.keepLocalData();
    expect(kept).toMatchObject({ status: 'connected', interval: 'daily', lastError: null });
    expect(kept.files).toHaveLength(7);
    expect(s.google.files.has(oldest)).toBe(false);
  });

  test('a file restore while backups wait for a choice keeps the restored data', async () => {
    const s = await connected();
    await s.backups.disconnect();
    await s.backups.connect();
    s.setLive(backupJson(5));
    s.advance(day);
    const kept = expectConnected(await s.backups.adoptAfterFileRestore());
    expect(kept).toMatchObject({ interval: 'daily', lastSuccess: s.now() });
    expect(kept.files).toHaveLength(2);
    expect(s.google.files.get(kept.files[1].id)?.transactions).toBe(5);
  });

  test('a file restore with a running schedule waits for the next due backup', async () => {
    const s = await connected();
    const before = s.state();
    s.advance(day / 2);
    expect(await s.backups.adoptAfterFileRestore()).toEqual(before);
    expect(s.snapshots()).toBe(1);
  });
});

describe('reconnect and account changes', () => {
  test('the same account continues quietly and backs up only when overdue', async () => {
    const s = await connected();
    await s.deps.save({ ...s.state(), lastError: { kind: 'auth', message: 'Access removed' } });
    const files = s.state().files;

    s.advance(day / 2);
    const notDue = await s.backups.connect();
    expect(notDue).toMatchObject({ kind: 'connected', state: { lastError: null, files } });
    expect(s.snapshots()).toBe(1);

    s.advance(day);
    const due = await s.backups.connect();
    expect(due.kind === 'connected' && due.state.files).toHaveLength(2);
  });

  test('a different account uses the first-connect rules', async () => {
    const s = await connected();
    s.signInAs('other@example.com');
    const other = await s.backups.connect();
    expect(other.kind).toBe('connected');
    expect(s.state().account?.email).toBe('other@example.com');
    expect(s.state().files).toHaveLength(1);
    expect(s.state().folderId).not.toBe(s.google.folders.get('you@example.com'));

    s.signInAs('you@example.com');
    expect((await s.backups.connect()).kind).toBe('backupsFound');
  });

  test('after Disconnect the same account uses the first-connect rules', async () => {
    const s = await connected();
    expect(await s.backups.disconnect()).toEqual(disconnectedState);
    expect(s.deps.signOut).toHaveBeenCalled();
    expect(s.google.files.size).toBe(1);
    expect((await s.backups.connect()).kind).toBe('backupsFound');
  });
});

describe('scheduled backups', () => {
  test('after removed access, only the user can start a backup', async () => {
    const s = await connected();
    await s.deps.save({ ...s.state(), lastError: { kind: 'auth', message: 'Access removed' } });
    s.advance(3 * day);
    expect((await s.runDue()).lastError?.kind).toBe('auth');
    expect(s.snapshots()).toBe(1);

    const retried = await s.runDue(true);
    expect(retried.lastError).toBeNull();
    expect(s.snapshots()).toBe(2);
  });

  test('daily and weekly checks wait until due', async () => {
    const s = await connected();
    s.advance(day - 1);
    await s.backups.runDue();
    expect(s.snapshots()).toBe(1);
    s.advance(1);
    await s.backups.runDue();
    expect(s.snapshots()).toBe(2);
    await s.backups.setInterval('weekly');
    s.advance(7 * day - 1);
    await s.backups.runDue();
    expect(s.snapshots()).toBe(2);
    s.advance(1);
    await s.backups.runDue();
    expect(s.snapshots()).toBe(3);
  });

  test('Off stops scheduled backups, but Back up now still works', async () => {
    const s = await connected();
    await s.backups.setInterval('off');
    s.advance(10 * day);
    await s.backups.runDue();
    expect(s.snapshots()).toBe(1);
    const manual = await s.runDue(true);
    expect(manual).toMatchObject({ interval: 'off', lastError: null });
    expect(manual.files).toHaveLength(2);
  });

  test('nothing runs while disconnected', async () => {
    const s = setup();
    expect(await s.backups.runDue(true)).toEqual(disconnectedState);
    expect(s.snapshots()).toBe(0);
    await expect(s.backups.setInterval('daily')).rejects.toThrow('Connect Google Drive first.');
  });

  test('concurrent foreground and background checks produce one backup', async () => {
    const s = await connected();
    s.advance(day);
    const results = await Promise.all(Array.from({ length: 5 }, () => s.runDue()));
    expect(s.snapshots()).toBe(2);
    expect(results.every((state) => state.files.length === 2)).toBe(true);
  });

  test('a clock moving backwards does not stop backups', async () => {
    const s = await connected();
    s.advance(-day);
    expect((await s.runDue()).files).toHaveLength(2);
  });

  test('a folder removed in Drive is made again', async () => {
    const s = await connected();
    const removed = s.state().folderId;
    s.google.folders.clear();
    s.advance(day);
    const next = await s.runDue();
    expect(next.lastError).toBeNull();
    expect(next.folderId).not.toBe(removed);
    expect(next.folderId).toBe(s.google.folders.get('you@example.com'));
  });
});

describe('failures', () => {
  test.each([
    [new DriveError('network', 'Network request failed'), 'network'],
    [new DriveError('auth', 'Access removed'), 'auth'],
    [new DriveError('quota', 'Drive is full'), 'quota'],
    [new Error('Something else'), 'other'],
  ] as const)('%s keeps the previous backups and records %s', async (error, kind) => {
    const s = await connected();
    const previous = s.state();
    const upload = s.google.drive.upload;
    s.google.drive.upload = async () => {
      throw error;
    };
    s.advance(day);
    const failed = await s.runDue();
    expect(failed).toMatchObject({
      lastSuccess: previous.lastSuccess,
      files: previous.files,
      lastError: { kind, message: error.message },
    });
    s.google.drive.upload = upload;
    // After removed access, only a backup that the user starts can try again.
    const recovered = await s.runDue(kind === 'auth');
    expect(recovered.lastError).toBeNull();
    expect(recovered.files).toHaveLength(2);
  });

  test('a backup that does not read back the same is removed and reported', async () => {
    const s = await connected();
    s.google.drive.download = async () => '{';
    s.advance(day);
    const failed = await s.runDue();
    expect(failed.lastError?.message).toBe('Backup verification failed.');
    expect(s.google.files.size).toBe(1);
  });

  test('retention removes only tracked files, after the new backup is saved', async () => {
    const s = await connected();
    const first = s.state().files[0].id;
    for (let index = 0; index < 7; index++) {
      s.advance(day);
      await s.backups.runDue();
    }
    expect(s.state().files).toHaveLength(7);
    expect(s.google.deleted).toEqual([first]);

    s.google.drive.remove = async () => {
      expect(s.state().files).toHaveLength(8);
      throw new DriveError('network', 'offline');
    };
    s.advance(day);
    const cleanupFailure = await s.runDue();
    expect(cleanupFailure).toMatchObject({
      lastError: null,
      removalError: { kind: 'network', message: 'offline' },
    });
    expect(cleanupFailure.files).toHaveLength(8);

    s.google.drive.remove = async (id) => {
      s.google.files.delete(id);
    };
    s.advance(day);
    expect(await s.runDue()).toMatchObject({ removalError: null });
    expect(s.state().files).toHaveLength(7);
  });

  test('a failed backup replaces the warning about older backups', async () => {
    const s = await connected();
    await s.deps.save({ ...s.state(), removalError: { kind: 'network', message: 'offline' } });
    s.google.drive.upload = async () => {
      throw new DriveError('network', 'offline');
    };
    s.advance(day);
    expect(await s.runDue()).toMatchObject({
      lastError: { kind: 'network' },
      removalError: null,
    });
  });

  test('a failed metadata save never removes recovery points, and the queue recovers', async () => {
    const s = await connected();
    const previous = s.state();
    const save = s.deps.save.getMockImplementation()!;
    s.deps.save.mockImplementation(async () => {
      throw new Error('disk full');
    });
    s.advance(day);
    await expect(s.backups.runDue()).rejects.toThrow('disk full');
    expect(s.state()).toEqual(previous);
    expect(s.google.deleted).toEqual([]);
    s.deps.save.mockImplementation(save);
    expect((await s.runDue()).files).toHaveLength(2);
  });

  test('a file restore and a scheduled backup cannot overlap', async () => {
    const s = await connected();
    s.advance(day);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const restore = restoreBackup(
      {
        snapshot: async () => {
          throw new Error('unused');
        },
        replace: async () => {
          entered.resolve();
          await release.promise;
          s.setLive(backupJson(5));
        },
      },
      {
        pickJsonDocument: async () => ({ uri: 'manual', name: 'backup.json' }),
        readText: async () => backupJson(5),
      },
      async () => true,
    );
    await entered.promise;
    const catchUp = s.runDue();
    await Promise.resolve();
    expect(s.google.files.size).toBe(1);
    release.resolve();
    await restore;
    const result = await catchUp;
    expect(s.google.files.get(result.files.at(-1)!.id)?.transactions).toBe(5);
  });
});

describe('needsAttention', () => {
  const base: ConnectedBackupState = {
    status: 'connected',
    account: { email: 'you@example.com', photoUrl: null },
    folderId: 'folder',
    interval: 'daily',
    connectedAt: 0,
    lastSuccess: 0,
    lastError: null,
    removalError: null,
    files: [],
  };
  test('one network failure is quiet until the schedule misses more than one interval', () => {
    const state = { ...base, lastError: { kind: 'network' as const, message: 'offline' } };
    expect(needsAttention(state, 2 * day)).toBe(false);
    expect(needsAttention(state, 2 * day + 1)).toBe(true);
    expect(needsAttention({ ...state, interval: 'weekly' }, 14 * day)).toBe(false);
    expect(needsAttention({ ...state, interval: 'weekly' }, 14 * day + 1)).toBe(true);
  });

  test('removed access and a full Drive need attention at once', () => {
    expect(needsAttention({ ...base, lastError: { kind: 'auth', message: '' } }, 0)).toBe(true);
    expect(needsAttention({ ...base, lastError: { kind: 'quota', message: '' } }, 0)).toBe(true);
  });

  test('no warning while disconnected, Off, or waiting for the user to choose', () => {
    expect(needsAttention(disconnectedState, 100 * day)).toBe(false);
    expect(needsAttention({ ...base, interval: 'off' }, 100 * day)).toBe(false);
    const waiting = {
      status: 'awaitingChoice' as const,
      account: base.account,
      folderId: 'folder',
      connectedAt: 0,
    };
    expect(needsAttention(waiting, 100 * day)).toBe(false);
  });

  test('a first backup that never succeeded counts from the connect time', () => {
    const state = { ...base, lastSuccess: null, connectedAt: day };
    expect(needsAttention(state, 3 * day)).toBe(false);
    expect(needsAttention(state, 3 * day + 1)).toBe(true);
  });
});
