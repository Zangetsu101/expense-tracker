import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { exportTransactionsCsv } from '@/lib/export-csv';
import { SettingsDataActions } from './settings-data-actions';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('@/components/backup-settings', () => {
  const { Pressable, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BackupSettings: ({
      disabled,
      onBusyChange,
    }: {
      disabled: boolean;
      onBusyChange: (busy: boolean) => void;
    }) => (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start backup"
          disabled={disabled}
          onPress={() => onBusyChange(true)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Finish backup"
          onPress={() => onBusyChange(false)}
        />
      </View>
    ),
  };
});
jest.mock('@/lib/export-csv', () => ({ exportTransactionsCsv: jest.fn() }));

let alert: jest.SpyInstance<ReturnType<typeof Alert.alert>, Parameters<typeof Alert.alert>>;
beforeEach(() => {
  jest.resetAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('pending work blocks duplicate actions and leaving, and reports success only after completion', async () => {
  const user = userEvent.setup();
  const onBusyChange = jest.fn();
  const completion = Promise.withResolvers<string | null>();
  jest.mocked(exportTransactionsCsv).mockReturnValue(completion.promise);
  await render(<SettingsDataActions onBusyChange={onBusyChange} />);
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  await user.press(screen.getByRole('button', { name: 'Export transactions CSV' }));

  expect(screen.getByRole('button', { name: 'Export transactions CSV' })).toBeBusy();
  for (const name of ['Export transactions CSV', 'Start backup'])
    expect(screen.getByRole('button', { name })).toBeDisabled();
  expect(screen.getByText('Export transactions CSV in progress…')).toBeOnTheScreen();
  expect(screen.queryByText('Transactions CSV exported.')).not.toBeOnTheScreen();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  await user.press(screen.getByRole('button', { name: 'Export transactions CSV' }));
  expect(exportTransactionsCsv).toHaveBeenCalledTimes(1);

  const navigation = jest.mocked(usePreventRemove).mock.calls.at(-1)!;
  expect(navigation[0]).toBe(true);
  await act(async () =>
    navigation[1]!({ data: { action: { type: 'GO_BACK' } }, repeat: jest.fn() }),
  );
  expect(alert).toHaveBeenCalledWith(
    'Operation in progress',
    expect.stringContaining('before leaving'),
  );

  await act(async () => completion.resolve('content://csv'));
  expect(await screen.findByText('Transactions CSV exported.')).toBeOnTheScreen();
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  expect(jest.mocked(usePreventRemove).mock.calls.at(-1)?.[0]).toBe(false);
  for (const name of ['Export transactions CSV', 'Start backup'])
    expect(screen.getByRole('button', { name })).toBeEnabled();
});

test('cancelling CSV export never reports success', async () => {
  const user = userEvent.setup();
  jest.mocked(exportTransactionsCsv).mockResolvedValue(null);
  await render(<SettingsDataActions />);
  await user.press(screen.getByRole('button', { name: 'Export transactions CSV' }));

  expect(await screen.findByText('Export transactions CSV cancelled.')).toBeOnTheScreen();
  expect(screen.queryByText('Transactions CSV exported.')).not.toBeOnTheScreen();
  expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Export transactions CSV' })).toBeEnabled();
});

test('Retry runs the export again after a failure', async () => {
  const user = userEvent.setup();
  jest
    .mocked(exportTransactionsCsv)
    .mockRejectedValueOnce(new Error('Write failed'))
    .mockResolvedValueOnce('content://csv');
  await render(<SettingsDataActions />);
  await user.press(screen.getByRole('button', { name: 'Export transactions CSV' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Export transactions CSV failed. Write failed',
  );
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('Transactions CSV exported.')).toBeOnTheScreen();
  expect(exportTransactionsCsv).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
});

test('Retry stays blocked during a backup and resumes when the backup finishes', async () => {
  const user = userEvent.setup();
  jest
    .mocked(exportTransactionsCsv)
    .mockRejectedValueOnce(new Error('Write failed'))
    .mockResolvedValueOnce('content://csv');
  await render(<SettingsDataActions />);
  await user.press(screen.getByRole('button', { name: 'Export transactions CSV' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Export transactions CSV failed. Write failed',
  );

  await user.press(screen.getByRole('button', { name: 'Start backup' }));
  expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  await user.press(screen.getByRole('button', { name: 'Retry' }));
  expect(exportTransactionsCsv).toHaveBeenCalledTimes(1);

  await user.press(screen.getByRole('button', { name: 'Finish backup' }));
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  await user.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Transactions CSV exported.')).toBeOnTheScreen();
  expect(exportTransactionsCsv).toHaveBeenCalledTimes(2);
});
