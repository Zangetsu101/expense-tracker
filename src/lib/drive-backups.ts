import { decodeBackup, serializeBackupOperation, type BackupData } from '@/lib/backup';

export type BackupInterval = 'off' | 'daily' | 'weekly';
export type BackupFailureKind = 'network' | 'auth' | 'quota' | 'other';
export type DriveBackupFile = { id: string; createdAt: number };
export type DriveBackupListing = DriveBackupFile & { size: number; transactions: number | null };
export type BackupFailure = { kind: BackupFailureKind; message: string };
export type GoogleAccount = { email: string; photoUrl: string | null };

export type DisconnectedBackupState = { status: 'disconnected' };

/** Drive had backups at first connect. Nothing runs until the user chooses what to do. */
export type AwaitingChoiceBackupState = {
  status: 'awaitingChoice';
  account: GoogleAccount;
  folderId: string;
  connectedAt: number;
};

export type ConnectedBackupState = {
  status: 'connected';
  account: GoogleAccount;
  folderId: string;
  interval: BackupInterval;
  connectedAt: number;
  lastSuccess: number | null;
  lastError: BackupFailure | null;
  /** The last backup succeeded, but older backups could not be removed. */
  removalError: BackupFailure | null;
  files: DriveBackupFile[];
};

export type DriveBackupState =
  DisconnectedBackupState | AwaitingChoiceBackupState | ConnectedBackupState;

/** A state with a Google account, before or after the user chooses. */
export type SignedInBackupState = AwaitingChoiceBackupState | ConnectedBackupState;

export const disconnectedState: DisconnectedBackupState = { status: 'disconnected' };

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
  | { kind: 'connected'; state: ConnectedBackupState }
  | { kind: 'backupsFound'; state: AwaitingChoiceBackupState; backups: DriveBackupListing[] };

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
  if (state.status !== 'connected') return false;
  if (state.lastError?.kind === 'auth' || state.lastError?.kind === 'quota') return true;
  if (state.interval === 'off') return false;
  const since = state.lastSuccess ?? state.connectedAt;
  return since !== null && now - since > 2 * intervalMs(state.interval);
}

export function createDriveBackups(deps: DriveBackupDependencies) {
  const { drive } = deps;

  async function run(state: ConnectedBackupState, force: boolean): Promise<ConnectedBackupState> {
    const now = deps.now();
    // An automatic try after removed access makes Google show its consent screen each time the
    // app opens. Only the user starts a backup until they reconnect.
    if (
      !force &&
      (state.interval === 'off' ||
        state.lastError?.kind === 'auth' ||
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
      const failed: ConnectedBackupState = {
        ...state,
        folderId,
        lastError: failureOf(error),
        removalError: null,
      };
      await deps.save(failed);
      return failed;
    }

    let next: ConnectedBackupState = {
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
    state: AwaitingChoiceBackupState,
    backups: DriveBackupListing[],
    lastSuccess: number | null,
  ): ConnectedBackupState {
    return {
      ...state,
      status: 'connected',
      interval: 'daily',
      lastSuccess,
      lastError: null,
      removalError: null,
      files: backups
        .map(({ id, createdAt }) => ({ id, createdAt }))
        .sort((a, b) => a.createdAt - b.createdAt),
    };
  }

  /** Adopt the Drive backups, then back up this phone's data at once. */
  async function keepPhoneData(state: AwaitingChoiceBackupState) {
    const adopted = adopt(state, await drive.list(state.folderId), null);
    await deps.save(adopted);
    return run(adopted, true);
  }

  return {
    status: () => serializeBackupOperation(() => deps.load()),
    runDue: (force = false) =>
      serializeBackupOperation(async (): Promise<DriveBackupState> => {
        const state = await deps.load();
        return state.status === 'connected' ? run(state, force) : state;
      }),

    connect: () =>
      serializeBackupOperation(async (): Promise<ConnectResult> => {
        const previous = await deps.load();
        const user = await deps.signIn();
        if (user === null) return { kind: 'cancelled' };
        if (previous.status === 'connected' && user.email === previous.account.email) {
          const resumed = { ...previous, account: user, lastError: null };
          await deps.save(resumed);
          return { kind: 'connected', state: await run(resumed, false) };
        }
        const folderId = await drive.findOrCreateFolder();
        const backups = await drive.list(folderId);
        const waiting: AwaitingChoiceBackupState = {
          status: 'awaitingChoice',
          account: user,
          folderId,
          connectedAt: deps.now(),
        };
        if (backups.length > 0) {
          await deps.save(waiting);
          return { kind: 'backupsFound', state: waiting, backups };
        }
        const fresh = adopt(waiting, [], null);
        await deps.save(fresh);
        return { kind: 'connected', state: await run(fresh, true) };
      }),

    keepLocalData: () =>
      serializeBackupOperation(async () => {
        const state = await deps.load();
        if (state.status === 'disconnected') throw new Error('Connect Google Drive first.');
        return state.status === 'awaitingChoice' ? keepPhoneData(state) : state;
      }),

    /** A restore from a file while backups wait for a choice counts as keeping this phone's data. */
    adoptAfterFileRestore: () =>
      serializeBackupOperation(async () => {
        const state = await deps.load();
        return state.status === 'awaitingChoice' ? keepPhoneData(state) : state;
      }),

    listBackups: () =>
      serializeBackupOperation(async () => {
        const state = await deps.load();
        if (state.status === 'disconnected') return [];
        return (await drive.list(state.folderId)).sort((a, b) => b.createdAt - a.createdAt);
      }),

    restore: (backup: DriveBackupListing, confirm: () => Promise<boolean>) =>
      serializeBackupOperation(async () => {
        const data = decodeBackup(await drive.download(backup.id));
        if (!(await confirm())) return false;
        await deps.replace(data);
        const state = await deps.load();
        if (state.status === 'awaitingChoice')
          await deps.save(adopt(state, await drive.list(state.folderId), backup.createdAt));
        return true;
      }),

    setInterval: (interval: BackupInterval) =>
      serializeBackupOperation(async () => {
        const state = await deps.load();
        if (state.status === 'disconnected') throw new Error('Connect Google Drive first.');
        if (state.status === 'awaitingChoice')
          throw new Error('Choose what to do with the backups in Google Drive first.');
        const next = { ...state, interval };
        await deps.save(next);
        return run(next, false);
      }),

    disconnect: () =>
      serializeBackupOperation(async () => {
        await deps.signOut();
        await deps.save(disconnectedState);
        return disconnectedState;
      }),
  };
}

export type DriveBackups = ReturnType<typeof createDriveBackups>;
