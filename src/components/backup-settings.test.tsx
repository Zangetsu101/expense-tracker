import { act, render, screen, userEvent, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert, Platform } from 'react-native';
import { restoreBackup, shareBackup } from '@/lib/backup';
import {
  reconcileBackupTask,
  runScheduledBackup,
  subscribeBackupSchedule,
} from '@/lib/backup-background-task';
import { driveBackups } from '@/lib/drive-backup-adapter';
import {
  disconnectedState,
  type DriveBackupListing,
  type DriveBackupState,
} from '@/lib/drive-backups';
import { BackupSettings } from './backup-settings';

jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Host: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    Column: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    Text: ({ children }: { children: ReactNode }) => <Text>{children}</Text>,
    Button: ({
      label,
      onPress,
      children,
    }: {
      label: string;
      onPress: () => void;
      children: ReactNode;
    }) => (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
        {children}
      </Pressable>
    ),
    BottomSheet: ({ isPresented, children }: { isPresented: boolean; children: ReactNode }) =>
      isPresented ? <View testID="sheet">{children}</View> : null,
  };
});
jest.mock('@/lib/backup', () => ({ shareBackup: jest.fn(), restoreBackup: jest.fn() }));
jest.mock('@/lib/backup-adapter', () => ({ backupStore: {}, backupDocuments: {} }));
jest.mock('@/lib/backup-background-task', () => ({
  withBackupChangeNotice: (operation: () => Promise<unknown>) => operation(),
  reconcileBackupTask: jest.fn(),
  runScheduledBackup: jest.fn(),
  subscribeBackupSchedule: jest.fn(),
}));
jest.mock('@/lib/drive-backup-adapter', () => ({
  driveBackups: {
    status: jest.fn(),
    connect: jest.fn(),
    keepLocalData: jest.fn(),
    adoptAfterFileRestore: jest.fn(),
    listBackups: jest.fn(),
    restore: jest.fn(),
    setInterval: jest.fn(),
    disconnect: jest.fn(),
  },
}));

const day = 24 * 60 * 60 * 1000;
const connected: DriveBackupState = {
  ...disconnectedState,
  account: { email: 'you@example.com', photoUrl: 'https://photos.example/you.png' },
  folderId: 'folder',
  interval: 'daily',
  connectedAt: Date.now() - day,
  lastSuccess: Date.now(),
  files: [{ id: 'a', createdAt: Date.now() }],
};
const listing = (id: string, daysAgo: number, transactions: number): DriveBackupListing => ({
  id,
  createdAt: Date.now() - daysAgo * day,
  size: 1.2 * 1024 * 1024,
  transactions,
});

const platform = Platform.OS;
let stored: DriveBackupState;
let alert: jest.SpyInstance<ReturnType<typeof Alert.alert>, Parameters<typeof Alert.alert>>;
beforeEach(() => {
  jest.resetAllMocks();
  Platform.OS = 'android';
  stored = structuredClone(disconnectedState);
  jest.mocked(driveBackups.status).mockImplementation(async () => structuredClone(stored));
  jest.mocked(reconcileBackupTask).mockResolvedValue(null);
  jest.mocked(subscribeBackupSchedule).mockReturnValue(() => {});
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  Platform.OS = platform;
});

async function mount(state: DriveBackupState = stored, props: { disabled?: boolean } = {}) {
  stored = structuredClone(state);
  const onBusyChange = jest.fn();
  await render(<BackupSettings disabled={props.disabled ?? false} onBusyChange={onBusyChange} />);
  return { onBusyChange };
}
const button = (name: string | RegExp) => screen.getByRole('button', { name });
async function chooseAlert(label: string) {
  const option = alert.mock.calls.at(-1)?.[2]?.find((candidate) => candidate.text === label);
  expect(option?.onPress).toBeDefined();
  await act(async () => option!.onPress!());
}

describe('not connected', () => {
  test('offers Connect, sharing a file and restoring from a file', async () => {
    await mount();
    expect(await screen.findByText('Back up to Google Drive')).toBeOnTheScreen();
    expect(button('Connect Google Drive')).toBeEnabled();
    expect(button('Share a backup file')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Schedule' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Google account' })).not.toBeOnTheScreen();

    const user = userEvent.setup();
    jest.mocked(restoreBackup).mockResolvedValue(false);
    await user.press(button('Restore'));
    expect(restoreBackup).toHaveBeenCalled();
    expect(driveBackups.listBackups).not.toHaveBeenCalled();
  });

  test('connecting to an empty Drive shows the first backup and the daily schedule', async () => {
    await mount();
    const user = userEvent.setup();
    jest.mocked(driveBackups.connect).mockImplementation(async () => {
      stored = connected;
      return { kind: 'connected', state: connected };
    });
    await user.press(await screen.findByRole('button', { name: 'Connect Google Drive' }));
    expect(await screen.findByRole('button', { name: 'Google account' })).toHaveAccessibilityValue({
      text: 'you@example.com',
    });
    expect(screen.getByText(/^Last backup: Today at /)).toBeOnTheScreen();
    expect(button('Back up now')).toBeEnabled();
    expect(button('Schedule')).toHaveAccessibilityValue({ text: 'Daily' });
    expect(screen.getByText('Backs up daily. Keeps the latest 7 backups.')).toBeOnTheScreen();
  });

  test('cancelling the account chooser changes nothing', async () => {
    await mount();
    const user = userEvent.setup();
    jest.mocked(driveBackups.connect).mockResolvedValue({ kind: 'cancelled' });
    await user.press(await screen.findByRole('button', { name: 'Connect Google Drive' }));
    expect(button('Connect Google Drive')).toBeEnabled();
    expect(screen.queryByTestId('sheet')).not.toBeOnTheScreen();
  });

  test('a sign-in failure shows the reason and keeps Connect available', async () => {
    await mount();
    const user = userEvent.setup();
    jest.mocked(driveBackups.connect).mockRejectedValue(new Error('DEVELOPER_ERROR'));
    await user.press(await screen.findByRole('button', { name: 'Connect Google Drive' }));
    expect(screen.getByRole('alert')).toHaveTextContent('DEVELOPER_ERROR');
    expect(button('Connect Google Drive')).toBeEnabled();
  });
});

describe('backups found at first connect', () => {
  const found = [listing('old', 3, 2300), listing('newest', 1, 2318)];
  async function connectToFound() {
    await mount();
    const user = userEvent.setup();
    const waiting = { ...connected, interval: 'off' as const, awaitingChoice: true, files: [] };
    jest.mocked(driveBackups.connect).mockImplementation(async () => {
      stored = waiting;
      return { kind: 'backupsFound', state: waiting, backups: found };
    });
    await user.press(await screen.findByRole('button', { name: 'Connect Google Drive' }));
    return user;
  }

  test('the sheet offers the newest backup first, other backups, and keeping local data', async () => {
    await connectToFound();
    const sheet = within(screen.getByTestId('sheet'));
    expect(sheet.getByText('Backups found in Google Drive')).toBeOnTheScreen();
    expect(sheet.getByText(/1\.2 MB · 2,318 transactions$/)).toBeOnTheScreen();
    expect(sheet.getByRole('button', { name: 'Choose another backup…' })).toBeOnTheScreen();
    expect(sheet.getByRole('button', { name: 'Keep this phone’s data' })).toBeOnTheScreen();
  });

  test('closing the sheet leaves the schedule off and offers Review backups', async () => {
    const user = await connectToFound();
    await user.press(within(screen.getByTestId('sheet')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Schedule' })).not.toBeOnTheScreen();
    expect(screen.getByText(/Choose what to do with them\.$/)).toBeOnTheScreen();

    jest.mocked(driveBackups.listBackups).mockResolvedValue(found);
    await user.press(button('Review backups'));
    expect(
      within(screen.getByTestId('sheet')).getByText('Backups found in Google Drive'),
    ).toBeOnTheScreen();
  });

  test('restoring the newest backup asks for confirmation first', async () => {
    const user = await connectToFound();
    let confirmed: Promise<boolean> | undefined;
    jest.mocked(driveBackups.restore).mockImplementation(async (backup, confirm) => {
      expect(backup.id).toBe('newest');
      confirmed = confirm();
      return confirmed;
    });
    await user.press(button('Restore the newest backup'));
    expect(alert.mock.calls.at(-1)?.[0]).toBe('Replace all current data?');
    expect(alert.mock.calls.at(-1)?.[1]).toMatch(
      /^Selected: Google Drive backup from Yesterday at /,
    );
    await chooseAlert('Replace data');
    expect(await confirmed).toBe(true);
    expect(
      await screen.findByText('Backup restored. Current data has been replaced.'),
    ).toBeOnTheScreen();
  });

  test('keeping this phone’s data backs up now', async () => {
    const user = await connectToFound();
    jest.mocked(driveBackups.keepLocalData).mockImplementation(async () => {
      stored = connected;
      return connected;
    });
    await user.press(button('Keep this phone’s data'));
    expect(driveBackups.keepLocalData).toHaveBeenCalled();
    expect(await screen.findByText(/^Last backup: Today at /)).toBeOnTheScreen();
  });

  test('Choose another backup lists every backup and a file option', async () => {
    const user = await connectToFound();
    await user.press(button('Choose another backup…'));
    const sheet = within(screen.getByTestId('sheet'));
    expect(sheet.getByText('Restore a backup')).toBeOnTheScreen();
    expect(sheet.getAllByText(/ · 2,3\d\d transactions$/)).toHaveLength(2);
    expect(sheet.getByRole('button', { name: 'Choose a file…' })).toBeOnTheScreen();
  });

  test('restoring a file counts as the choice and turns on the schedule', async () => {
    const user = await connectToFound();
    await user.press(button('Choose another backup…'));
    jest.mocked(restoreBackup).mockResolvedValue(true);
    jest.mocked(driveBackups.adoptAfterFileRestore).mockImplementation(async () => {
      stored = connected;
      return connected;
    });
    await user.press(button('Choose a file…'));
    expect(await screen.findByRole('button', { name: 'Schedule' })).toHaveAccessibilityValue({
      text: 'Daily',
    });
    expect(screen.getByText('Backup restored. Current data has been replaced.')).toBeOnTheScreen();
  });
});

describe('connected', () => {
  test('the card shows the Google account photo', async () => {
    await mount(connected);
    expect(await screen.findByRole('image', { name: 'Profile photo' })).toHaveProp('source', {
      uri: 'https://photos.example/you.png',
    });
  });

  test('without a photo, the card shows the first letter of the email', async () => {
    await mount({ ...connected, account: { email: 'you@example.com', photoUrl: null } });
    // The letter is decorative, so screen readers skip it.
    expect(await screen.findByText('Y', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByRole('image', { name: 'Profile photo' })).not.toBeOnTheScreen();
  });

  test('Back up now runs a backup and locks every control while it runs', async () => {
    const { onBusyChange } = await mount(connected);
    const user = userEvent.setup();
    const completion = Promise.withResolvers<DriveBackupState>();
    jest.mocked(runScheduledBackup).mockReturnValue(completion.promise);
    await user.press(await screen.findByRole('button', { name: 'Back up now' }));

    expect(runScheduledBackup).toHaveBeenCalledWith(true);
    expect(screen.getByText('Backing up to Google Drive…')).toBeOnTheScreen();
    for (const name of [
      'Back up now',
      'Schedule',
      'Share a backup file',
      'Restore',
      'Google account',
    ])
      expect(button(name)).toBeDisabled();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await act(async () => completion.resolve(connected));
    expect(button('Back up now')).toBeEnabled();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  test('the parent can disable every control', async () => {
    await mount(connected, { disabled: true });
    for (const name of ['Back up now', 'Schedule', 'Share a backup file', 'Restore'])
      expect(await screen.findByRole('button', { name })).toBeDisabled();
  });

  test('Share a backup file opens the share sheet', async () => {
    await mount(connected);
    const user = userEvent.setup();
    jest.mocked(shareBackup).mockResolvedValue();
    await user.press(await screen.findByRole('button', { name: 'Share a backup file' }));
    expect(shareBackup).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  });

  test('the schedule sheet changes the interval', async () => {
    await mount(connected);
    const user = userEvent.setup();
    jest.mocked(driveBackups.setInterval).mockImplementation(async (interval) => {
      stored = { ...connected, interval };
      return stored;
    });
    await user.press(await screen.findByRole('button', { name: 'Schedule' }));
    expect(screen.getByRole('button', { name: 'Daily' })).toHaveTextContent('Daily  ✓');
    await user.press(screen.getByRole('button', { name: 'Off' }));
    expect(driveBackups.setInterval).toHaveBeenCalledWith('off');
    expect(button('Schedule')).toHaveAccessibilityValue({ text: 'Off' });
    expect(screen.getByText(/^Automatic backups off\./)).toBeOnTheScreen();
  });

  test('Restore lists the Drive backups; cancelling the confirmation keeps the data', async () => {
    await mount(connected);
    const user = userEvent.setup();
    jest.mocked(driveBackups.listBackups).mockResolvedValue([listing('a', 0, 1)]);
    jest.mocked(driveBackups.restore).mockImplementation(async (_backup, confirm) => confirm());
    await user.press(await screen.findByRole('button', { name: 'Restore' }));
    expect(
      within(screen.getByTestId('sheet')).getByText(/1\.2 MB · 1 transaction$/),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: /^Today at / }));
    await chooseAlert('Cancel');
    expect(screen.queryByText(/Backup restored/)).not.toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  });

  test('a failed restore keeps the data and the Restore row offers Retry', async () => {
    await mount(connected);
    const user = userEvent.setup();
    jest.mocked(driveBackups.listBackups).mockResolvedValue([listing('a', 0, 1)]);
    jest.mocked(driveBackups.restore).mockRejectedValue(new Error('Invalid backup'));
    await user.press(await screen.findByRole('button', { name: 'Restore' }));
    await user.press(screen.getByRole('button', { name: /^Today at / }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Restore failed. Current data was kept. Invalid backup',
    );
    expect(button('Restore')).toHaveAccessibilityValue({ text: 'Retry' });
  });

  test('the account sheet can switch accounts or disconnect', async () => {
    await mount(connected);
    const user = userEvent.setup();
    await user.press(await screen.findByRole('button', { name: 'Google account' }));
    expect(screen.getByText('Stops automatic backups. Files in Drive stay.')).toBeOnTheScreen();
    jest.mocked(driveBackups.connect).mockResolvedValue({ kind: 'cancelled' });
    await user.press(screen.getByRole('button', { name: 'Switch account' }));
    expect(driveBackups.connect).toHaveBeenCalled();

    jest.mocked(driveBackups.disconnect).mockImplementation(async () => {
      stored = disconnectedState;
      return disconnectedState;
    });
    await user.press(button('Google account'));
    await user.press(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('button', { name: 'Connect Google Drive' })).toBeOnTheScreen();
  });
});

describe('failures', () => {
  test('removed access asks the user to reconnect', async () => {
    await mount({ ...connected, lastError: { kind: 'auth', message: 'Invalid Credentials' } });
    expect(
      await screen.findByText('Google Drive access was removed. Reconnect to keep backing up.'),
    ).toBeOnTheScreen();
    const user = userEvent.setup();
    jest.mocked(driveBackups.connect).mockImplementation(async () => {
      stored = connected;
      return { kind: 'connected', state: connected };
    });
    await user.press(button('Reconnect'));
    expect(driveBackups.connect).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Back up now' })).toBeOnTheScreen();
  });

  test('a full Drive and a retention failure are warnings', async () => {
    await mount({ ...connected, lastError: { kind: 'quota', message: 'quota' } });
    expect(await screen.findByRole('button', { name: 'Retry backup' })).toBeOnTheScreen();
    expect(screen.getByRole('alert')).toHaveTextContent('Your Google Drive is full.', {
      exact: false,
    });
    await screen.unmount();

    await mount({ ...connected, removalError: { kind: 'network', message: 'offline' } });
    expect(
      await screen.findByText('Backup saved. Older backups couldn’t be removed.'),
    ).toBeOnTheScreen();
  });

  test('one network failure is quiet', async () => {
    await mount({ ...connected, lastError: { kind: 'network', message: 'offline' } });
    expect(await screen.findByText(/· waiting for internet$/)).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  });

  test('a failed first read can retry in place', async () => {
    jest.mocked(driveBackups.status).mockRejectedValueOnce(new Error('database locked'));
    await mount(connected);
    expect(await screen.findByText('Backup settings couldn’t be loaded.')).toBeOnTheScreen();
    const user = userEvent.setup();
    await user.press(button('Retry'));
    expect(await screen.findByRole('button', { name: 'Back up now' })).toBeOnTheScreen();
  });

  test('a restricted background scheduler is a short footer note', async () => {
    jest.mocked(reconcileBackupTask).mockResolvedValue('Background backups are unavailable.');
    await mount(connected);
    expect(
      await screen.findByText('Automatic backups run when you open the app.'),
    ).toBeOnTheScreen();
  });
});

test('other platforms can share and restore files, without Drive backups', async () => {
  Platform.OS = 'ios';
  await mount();
  expect(screen.getByText('Automatic backups are available on Android.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Connect Google Drive' })).not.toBeOnTheScreen();
  expect(button('Share a backup file')).toBeEnabled();
  expect(driveBackups.status).not.toHaveBeenCalled();
});
