import { serializeBackupOperation } from './backup';

export type BackupInterval = 'off' | 'daily' | 'weekly';
export type ScheduledBackupState = {
  interval: BackupInterval;
  directoryUri: string | null;
  lastSuccess: number | null;
  lastError: string | null;
  attempt?: number;
  files: { uri: string; createdAt: number }[];
};
export const emptyBackupSchedule: ScheduledBackupState = {
  interval: 'off',
  directoryUri: null,
  lastSuccess: null,
  lastError: null,
  files: [],
};

export interface ScheduledBackupDependencies {
  load(): Promise<ScheduledBackupState>;
  save(state: ScheduledBackupState): Promise<void>;
  snapshotJson(): Promise<string>;
  create(directoryUri: string, name: string): Promise<string>;
  write(uri: string, text: string): Promise<void>;
  read(uri: string): Promise<string>;
  remove(uri: string): Promise<void>;
  now(): number;
}

const day = 24 * 60 * 60 * 1000;
const retention = 7;

/** Shares serialization with manual JSON backup and restore in this runtime. */
export function createScheduledBackups(deps: ScheduledBackupDependencies) {
  async function run(state: ScheduledBackupState, force: boolean) {
    const now = deps.now();
    if (
      (!force && state.interval === 'off') ||
      !state.directoryUri ||
      (!force &&
        state.lastSuccess !== null &&
        now >= state.lastSuccess &&
        now - state.lastSuccess < (state.interval === 'daily' ? day : 7 * day))
    )
      return state;

    const attempt = (state.attempt ?? 0) + 1;
    let uri: string | undefined;
    try {
      const json = await deps.snapshotJson();
      const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
      uri = await deps.create(
        state.directoryUri,
        `expense-backup-${stamp}-${Math.random().toString(36).slice(2, 10)}.json`,
      );
      await deps.write(uri, json);
      if ((await deps.read(uri)) !== json) throw new Error('Backup verification failed.');
    } catch (error) {
      if (uri) await deps.remove(uri).catch(() => {});
      const failed = {
        ...state,
        attempt,
        lastError: error instanceof Error ? error.message : String(error),
      };
      await deps.save(failed);
      return failed;
    }

    let next: ScheduledBackupState = {
      ...state,
      attempt,
      lastSuccess: now,
      lastError: null,
      files: [...state.files, { uri, createdAt: now }],
    };
    await deps.save(next);
    const excess = next.files.slice(0, Math.max(0, next.files.length - retention));
    for (const file of excess) {
      try {
        await deps.remove(file.uri);
        next = { ...next, files: next.files.filter((item) => item.uri !== file.uri) };
      } catch (error) {
        next = {
          ...next,
          lastError: `Backup saved, but an older backup could not be removed. ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    if (excess.length) await deps.save(next);
    return next;
  }

  return {
    status: () => serializeBackupOperation(() => deps.load()),
    runDue: (force = false) => serializeBackupOperation(async () => run(await deps.load(), force)),
    configure: (interval: BackupInterval, directoryUri?: string) =>
      serializeBackupOperation(async () => {
        const previous = await deps.load();
        const folder = directoryUri ?? previous.directoryUri;
        if (interval !== 'off' && !folder) throw new Error('Choose a backup folder first.');
        const changedFolder = folder !== previous.directoryUri;
        const next: ScheduledBackupState = {
          ...(changedFolder ? emptyBackupSchedule : previous),
          interval,
          attempt: previous.attempt,
          directoryUri: folder,
          lastError: previous.lastError,
        };
        await deps.save(next);
        return run(next, interval !== 'off');
      }),
  };
}
