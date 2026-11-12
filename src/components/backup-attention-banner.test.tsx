import { act, render, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { subscribeBackupSchedule } from '@/lib/backup-background-task';
import { driveBackups } from '@/lib/drive-backup-adapter';
import { type ConnectedBackupState, type DriveBackupState } from '@/lib/drive-backups';
import { BackupAttentionBanner } from './backup-attention-banner';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/backup-background-task', () => ({ subscribeBackupSchedule: jest.fn() }));
jest.mock('@/lib/drive-backup-adapter', () => ({ driveBackups: { status: jest.fn() } }));

const day = 24 * 60 * 60 * 1000;
const healthy: ConnectedBackupState = {
  status: 'connected',
  account: { email: 'you@example.com', photoUrl: null },
  folderId: 'folder',
  interval: 'daily',
  connectedAt: Date.now() - 10 * day,
  lastSuccess: Date.now(),
  lastError: null,
  removalError: null,
  files: [],
};
const platform = Platform.OS;
let stored: DriveBackupState;
let changed: () => void;
let appState: (state: AppStateStatus) => void;
beforeEach(() => {
  jest.resetAllMocks();
  Platform.OS = 'android';
  jest.mocked(driveBackups.status).mockImplementation(async () => stored);
  jest.mocked(subscribeBackupSchedule).mockImplementation((listener) => {
    changed = listener;
    return () => {};
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appState = listener;
    return { remove: jest.fn() };
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  Platform.OS = platform;
});

test('no banner while backups are healthy or only waiting for internet', async () => {
  stored = { ...healthy, lastError: { kind: 'network', message: 'offline' } };
  await render(<BackupAttentionBanner />);
  await act(async () => {});
  expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
});

test('a problem that needs attention shows until a backup succeeds', async () => {
  stored = { ...healthy, lastError: { kind: 'auth', message: 'Invalid Credentials' } };
  await render(<BackupAttentionBanner />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Google Drive access was removed. Reconnect to keep backing up.',
  );
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Open backup settings' }));
  expect(router.push).toHaveBeenCalledWith('/settings');

  stored = healthy;
  await act(async () => changed());
  expect(screen.queryByRole('alert')).not.toBeOnTheScreen();

  stored = { ...healthy, lastError: { kind: 'quota', message: 'quota' } };
  await act(async () => appState('active'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your Google Drive is full. Free up space, then retry.',
  );
});

test('an overdue schedule shows a banner', async () => {
  stored = {
    ...healthy,
    lastSuccess: Date.now() - 3 * day,
    lastError: { kind: 'network', message: 'offline' },
  };
  await render(<BackupAttentionBanner />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /^No backup since .*\. The app couldn’t reach Google Drive\.$/,
  );
});

test('no banner on other platforms', async () => {
  Platform.OS = 'ios';
  stored = { ...healthy, lastError: { kind: 'auth', message: '' } };
  await render(<BackupAttentionBanner />);
  expect(driveBackups.status).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
});
