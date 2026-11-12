import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { encodeBackup } from '@/lib/backup';
import { backupStore } from '@/lib/backup-adapter';
import { database } from '@/lib/database';
import {
  createDriveBackups,
  disconnectedState,
  DriveError,
  type ConnectedBackupState,
  type DriveBackupState,
} from '@/lib/drive-backups';
import { createGoogleDrive } from '@/lib/google-drive';

const settingsKey = 'driveBackups';
type UnmarkedState = Omit<ConnectedBackupState, 'status' | 'account'> & {
  status?: undefined;
  account: ConnectedBackupState['account'] | null;
  awaitingChoice?: boolean;
};
const driveScope = 'https://www.googleapis.com/auth/drive.file';
const noCredentialMessage = 'Google sign-in has no saved account for Expense Tracker.';
/** Google Play services reports CommonStatusCodes.NETWORK_ERROR when the phone is offline. */
const playServicesNetworkError = '7';

let configured = false;
/** The background task starts JavaScript without the UI, so each entry point configures. */
function google() {
  if (!configured) {
    GoogleSignin.configure({ scopes: [driveScope] });
    configured = true;
  }
  return GoogleSignin;
}

function codeOf(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}
function signInFailure(error: unknown): DriveError {
  const message = error instanceof Error ? error.message : String(error);
  if (codeOf(error) === playServicesNetworkError || /network/i.test(message))
    return new DriveError('network', message);
  return new DriveError('auth', message);
}

async function accessToken() {
  const signIn = google();
  try {
    const silent = await signIn.signInSilently();
    if (silent.type === 'noSavedCredentialFound') throw new DriveError('auth', noCredentialMessage);
    if (!silent.data.scopes.includes(driveScope))
      throw new DriveError('auth', 'Allow Expense Tracker to use Google Drive, then reconnect.');
    return (await signIn.getTokens()).accessToken;
  } catch (error) {
    throw error instanceof DriveError ? error : signInFailure(error);
  }
}

export const driveBackups = createDriveBackups({
  async load() {
    const row = await (
      await database()
    ).getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [
      settingsKey,
    ]);
    if (!row) return disconnectedState;
    const stored = JSON.parse(row.value) as DriveBackupState | UnmarkedState;
    if (stored.status) return stored;
    // A test build of 0.2.0 saved the state without a status. Convert it to the new form.
    // Remove this conversion and UnmarkedState in 0.2.1. Only test phones have these rows.
    const { account, awaitingChoice, folderId, connectedAt, ...rest } = stored;
    if (!account) return disconnectedState;
    if (awaitingChoice) return { status: 'awaitingChoice', account, folderId, connectedAt };
    return { ...rest, status: 'connected', account, folderId, connectedAt };
  },
  async save(state) {
    await (
      await database()
    ).runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
      settingsKey,
      JSON.stringify(state),
    ]);
  },
  async signIn() {
    const signIn = google();
    await signIn.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Sign out first so that the account chooser always opens. The Drive grant stays.
    await signIn.signOut();
    try {
      const result = await signIn.signIn();
      if (result.type === 'cancelled') return null;
      if (!result.data.scopes.includes(driveScope))
        throw new Error('Allow Expense Tracker to use Google Drive to turn on backups.');
      return { email: result.data.user.email, photoUrl: result.data.user.photo };
    } catch (error) {
      if (codeOf(error) === statusCodes.SIGN_IN_CANCELLED) return null;
      throw error;
    }
  },
  signOut: async () => {
    await google().signOut();
  },
  drive: createGoogleDrive({
    accessToken,
    invalidate: async (token) => {
      await google().clearCachedAccessToken(token);
    },
    fetch: (url, init) => fetch(url, init),
  }),
  async snapshot() {
    const data = await backupStore.snapshot();
    return { json: encodeBackup(data), transactions: data.transactions.length };
  },
  replace: (data) => backupStore.replace(data),
  now: Date.now,
});
