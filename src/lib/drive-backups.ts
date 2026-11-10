import { decodeBackup, serializeBackupOperation, type BackupData } from '@/lib/backup';

export type BackupInterval = 'off' | 'daily' | 'weekly';
export type BackupFailureKind = 'network' | 'auth' | 'quota' | 'other';
export type DriveBackupFile = { id: string; createdAt: number };
export type DriveBackupListing = DriveBackupFile & { size: number; transactions: number | null };
export type BackupFailure = { kind: BackupFailureKind; message: string };
export type GoogleAccount = { email: string; photoUrl: string | null };

export type DriveBackupState = {
  account: string | null;
  photoUrl: string | null;
  folderId: string | null;
  interval: BackupInterval;
  connectedAt: number | null;
  lastSuccess: number | null;
  lastError: BackupFailure | null;
  /** Drive had backups at first connect; nothing runs until the user chooses. */
  awaitingChoice: boolean;
  /** The last backup succeeded, but older backups could not be removed. */
  removalError: BackupFailure | null;
  files: DriveBackupFile[];
};

export const disconnectedState: DriveBackupState = {
  account: null,
  photoUrl: null,
  folderId: null,
  interval: 'off',
  connectedAt: null,
  lastSuccess: null,
  lastError: null,
  awaitingChoice: false,
  removalError: null,
  files: [],
};

export class DriveError extends Error {
  constructor(
    readonly kind: BackupFailureKind | 'notFound',
    message: string,
  ) {
    super(message);
  }
}

export interface DriveFolder {
  findOrCreateFolder(): Promise<string>;
  list(folderId: string): Promise<DriveBackupListing[]>;
  upload(
    folderId: string,
    name: string,
    json: string,
    transactions: number,
  ): Promise<DriveBackupFile>;
  download(fileId: string): Promise<string>;
  remove(fileId: string): Promise<void>;
}

export interface DriveBackupDependencies {
  load(): Promise<DriveBackupState>;
  save(state: DriveBackupState): Promise<void>;
  /** Interactive sign-in. Returns null when the user cancels. */
  signIn(): Promise<GoogleAccount | null>;
  signOut(): Promise<void>;
  drive: DriveFolder;
  snapshot(): Promise<{ json: string; transactions: number }>;
  replace(data: BackupData): Promise<void>;
  now(): number;
}

export type ConnectResult =
  | { kind: 'cancelled' }
  | { kind: 'connected'; state: DriveBackupState }
  | { kind: 'backupsFound'; state: DriveBackupState; backups: DriveBackupListing[] };

const day = 24 * 60 * 60 * 1000;
const retention = 7;
const intervalMs = (interval: BackupInterval) => (interval === 'weekly' ? 7 * day : day);

function failureOf(error: unknown): BackupFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof DriveError && error.kind !== 'notFound')
    return { kind: error.kind, message };
  return { kind: 'other', message };
}

/** A failure the user must act on, or a schedule that has missed more than one interval. */
export function needsAttention(state: DriveBackupState, now: number): boolean {
  if (!state.account || state.awaitingChoice) return false;
  if (state.lastError?.kind === 'auth' || state.lastError?.kind === 'quota') return true;
  if (state.interval === 'off') return false;
  const since = state.lastSuccess ?? state.connectedAt;
  return since !== null && now - since > 2 * intervalMs(state.interval);
}

export function createDriveBackups(deps: DriveBackupDependencies) {
  const { drive } = deps;

  async function run(state: DriveBackupState, force: boolean): Promise<DriveBackupState> {
    const now = deps.now();
    if (!state.account || !state.folderId || state.awaitingChoice) return state;
    if (
      !force &&
      (state.interval === 'off' ||
        (state.lastSuccess !== null &&
          now >= state.lastSuccess &&
          now - state.lastSuccess < intervalMs(state.interval)))
    )
      return state;

    let folderId = state.folderId;
    let uploaded: DriveBackupFile | undefined;
    try {
      const { json, transactions } = await deps.snapshot();
      const name = `expense-backup-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`;
      try {
        uploaded = await drive.upload(folderId, name, json, transactions);
      } catch (error) {
        if (!(error instanceof DriveError && error.kind === 'notFound')) throw error;
        // The user removed the folder in Drive. Make a new one and keep going.
        folderId = await drive.findOrCreateFolder();
        uploaded = await drive.upload(folderId, name, json, transactions);
      }
      if ((await drive.download(uploaded.id)) !== json)
        throw new Error('Backup verification failed.');
    } catch (error) {
      if (uploaded) await drive.remove(uploaded.id).catch(() => {});
      // A failed backup replaces the older warning about removal.
      const failed = { ...state, folderId, lastError: failureOf(error), removalError: null };
      await deps.save(failed);
      return failed;
    }

    let next: DriveBackupState = {
      ...state,
      folderId,
      lastSuccess: now,
      lastError: null,
      removalError: null,
      files: [...state.files, uploaded],
    };
    await deps.save(next);
    const excess = next.files.slice(0, Math.max(0, next.files.length - retention));
    for (const file of excess) {
      try {
        await drive.remove(file.id);
        next = { ...next, files: next.files.filter((item) => item.id !== file.id) };
      } catch (error) {
        next = { ...next, removalError: failureOf(error) };
      }
    }
    if (excess.length) await deps.save(next);
    return next;
  }

  /** Adopt the backups found in Drive so that retention counts them, then turn on the schedule. */
  function adopt(
    state: DriveBackupState,
    backups: DriveBackupListing[],
    lastSuccess: number | null,
  ): DriveBackupState {
    return {
      ...state,
      awaitingChoice: false,
      interval: 'daily',
      lastSuccess,
      files: backups
        .map(({ id, createdAt }) => ({ id, createdAt }))
        .sort((a, b) => a.createdAt - b.createdAt),
    };
  }

  /** Adopt the Drive backups, then back up this phone's data at once. */
  async function keepPhoneData(state: DriveBackupState) {
    if (!state.folderId) throw new Error('Connect Google Drive first.');
    const adopted = adopt(state, await drive.list(state.folderId), null);
    await deps.save(adopted);
    return run(adopted, true);
  }

  return {
    status: () => serializeBackupOperation(() => deps.load()),
    runDue: (force = false) => serializeBackupOperation(async () => run(await deps.load(), force)),

    connect: () =>
      serializeBackupOperation(async (): Promise<ConnectResult> => {
        const previous = await deps.load();
        const user = await deps.signIn();
        if (user === null) return { kind: 'cancelled' };
        const account = user.email;
        if (account === previous.account && previous.folderId && !previous.awaitingChoice) {
          const resumed = { ...previous, photoUrl: user.photoUrl, lastError: null };
          await deps.save(resumed);
          return { kind: 'connected', state: await run(resumed, false) };
        }
        const folderId = await drive.findOrCreateFolder();
        const backups = await drive.list(folderId);
        const fresh: DriveBackupState = {
          ...disconnectedState,
          account,
          photoUrl: user.photoUrl,
          folderId,
          connectedAt: deps.now(),
          awaitingChoice: backups.length > 0,
          interval: backups.length > 0 ? 'off' : 'daily',
        };
        await deps.save(fresh);
        if (backups.length > 0) return { kind: 'backupsFound', state: fresh, backups };
        return { kind: 'connected', state: await run(fresh, true) };
      }),

    keepLocalData: () => serializeBackupOperation(async () => keepPhoneData(await deps.load())),

    /** A restore from a file while backups wait for a choice counts as keeping this phone's data. */
    adoptAfterFileRestore: () =>
      serializeBackupOperation(async () => {
        const state = await deps.load();
        return state.awaitingChoice ? keepPhoneData(state) : state;
      }),

    listBackups: () =>
      serializeBackupOperation(async () => {
        const state = await deps.load();
        if (!state.folderId) return [];
        return (await drive.list(state.folderId)).sort((a, b) => b.createdAt - a.createdAt);
      }),

    restore: (backup: DriveBackupListing, confirm: () => Promise<boolean>) =>
      serializeBackupOperation(async () => {
        const data = decodeBackup(await drive.download(backup.id));
        if (!(await confirm())) return false;
        await deps.replace(data);
        const state = await deps.load();
        if (state.awaitingChoice && state.folderId)
          await deps.save(adopt(state, await drive.list(state.folderId), backup.createdAt));
        return true;
      }),

    setInterval: (interval: BackupInterval) =>
      serializeBackupOperation(async () => {
        const state = await deps.load();
        if (!state.account) throw new Error('Connect Google Drive first.');
        const next = { ...state, interval };
        await deps.save(next);
        return run(next, false);
      }),

    disconnect: () =>
      serializeBackupOperation(async () => {
        await deps.signOut();
        await deps.save({ ...disconnectedState });
        return { ...disconnectedState };
      }),
  };
}

export type DriveBackups = ReturnType<typeof createDriveBackups>;
