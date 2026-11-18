import { act, render, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import SettingsScreen from '@/app/settings';
import { AppUpdatesProvider } from './app-updates';
import { shareBackup } from '@/lib/backup';
import { disconnectedState as mockDisconnectedState } from '@/lib/drive-backups';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn() },
  useFocusEffect: () => {},
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('expo-updates', () => ({ useUpdates: () => ({}), isEnabled: false }));
jest.mock('@/lib/backup', () => ({ shareBackup: jest.fn(), restoreBackup: jest.fn() }));
jest.mock('@/lib/backup-adapter', () => ({ backupStore: {}, backupDocuments: {} }));
jest.mock('@/lib/drive-backup-adapter', () => ({
  driveBackups: { status: async () => mockDisconnectedState },
}));
jest.mock('@/lib/backup-background-task', () => ({
  subscribeBackupSchedule: () => () => {},
  reconcileBackupTask: async () => null,
  withBackupChangeNotice: (operation: () => Promise<unknown>) => operation(),
}));
jest.mock('@/lib/export-csv', () => ({ exportTransactionsCsv: jest.fn() }));
jest.mock('@/lib/import-csv', () => ({ importMoneyLoverFile: jest.fn() }));
test('Settings exposes data actions and hides other navigation until a backup finishes', async () => {
  const user = userEvent.setup();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof shareBackup>>>();
  jest.mocked(shareBackup).mockReturnValueOnce(pending.promise);
  await render(
    <AppUpdatesProvider>
      <SettingsScreen />
    </AppUpdatesProvider>,
  );
  for (const name of [
    'Restore',
    'Export transactions CSV',
    'Import from MoneyLover',
    /^Version /,
  ]) {
    expect(screen.getByRole('button', { name })).toBeOnTheScreen();
  }
  await user.press(screen.getByRole('button', { name: 'Share a backup file' }));
  expect(shareBackup).toHaveBeenCalledTimes(1);
  for (const name of ['Lending & borrowing', 'Review transfer candidates']) {
    expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByRole('button', { name, includeHiddenElements: true })).toBeDisabled();
  }
  await act(async () => pending.resolve(undefined));
  await user.press(screen.getByRole('button', { name: 'Review transfer candidates' }));
  expect(router.push).toHaveBeenCalledWith('/review-queue');
});
