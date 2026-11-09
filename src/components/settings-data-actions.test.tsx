import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { exportTransactionsCsv } from '@/lib/export-csv';
import { importMoneyLoverFile } from '@/lib/import-csv';
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
jest.mock('@/lib/import-csv', () => ({ importMoneyLoverFile: jest.fn() }));

let alert: jest.SpyInstance<ReturnType<typeof Alert.alert>, Parameters<typeof Alert.alert>>;
beforeEach(() => {
  jest.resetAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function chooseAlert(label: string) {
  const buttons = alert.mock.calls.at(-1)?.[2];
  const button = buttons?.find((candidate) => candidate.text === label);
  expect(button?.onPress).toBeDefined();
  await act(async () => button!.onPress!());
}

test('pending work blocks duplicate actions and leaving, and reports success only after completion', async () => {
  const user = userEvent.setup();
  const onBusyChange = jest.fn();
  const completion = Promise.withResolvers<string | null>();
  jest.mocked(exportTransactionsCsv).mockReturnValue(completion.promise);
  await render(<SettingsDataActions onBusyChange={onBusyChange} />);
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  await user.press(screen.getByRole('button', { name: 'Export transactions CSV' }));

  expect(screen.getByRole('button', { name: 'Export transactions CSV' })).toBeBusy();
  for (const name of ['Export transactions CSV', 'Import from MoneyLover', 'Start backup'])
    expect(screen.getByRole('button', { name })).toBeDisabled();
  expect(screen.getByText('Export transactions CSV in progress…')).toBeOnTheScreen();
  expect(screen.queryByText('Transactions CSV exported.')).not.toBeOnTheScreen();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  await user.press(screen.getByRole('button', { name: 'Export transactions CSV' }));
  await user.press(screen.getByRole('button', { name: 'Import from MoneyLover' }));
  expect(exportTransactionsCsv).toHaveBeenCalledTimes(1);
  expect(importMoneyLoverFile).not.toHaveBeenCalled();

  const navigation = jest.mocked(usePreventRemove).mock.calls.at(-1)!;
  expect(navigation[0]).toBe(true);
  await act(async () => navigation[1]({ data: { action: { type: 'GO_BACK' } } }));
  expect(alert).toHaveBeenCalledWith(
    'Operation in progress',
    expect.stringContaining('before leaving'),
  );

  await act(async () => completion.resolve('content://csv'));
  expect(await screen.findByText('Transactions CSV exported.')).toBeOnTheScreen();
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  expect(jest.mocked(usePreventRemove).mock.calls.at(-1)?.[0]).toBe(false);
  for (const name of ['Export transactions CSV', 'Import from MoneyLover', 'Start backup'])
    expect(screen.getByRole('button', { name })).toBeEnabled();
});

test.each([
  ['Export transactions CSV', 'Transactions CSV exported.'],
  ['Import from MoneyLover', '0 transactions imported.'],
])('cancelling %s never reports success', async (label, success) => {
  const user = userEvent.setup();
  jest.mocked(exportTransactionsCsv).mockResolvedValue(null);
  jest.mocked(importMoneyLoverFile).mockResolvedValue(null);
  await render(<SettingsDataActions />);
  await user.press(screen.getByRole('button', { name: label }));

  expect(await screen.findByText(`${label} cancelled.`)).toBeOnTheScreen();
  expect(screen.queryByText(success)).not.toBeOnTheScreen();
  expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: label })).toBeEnabled();
});

test.each([
  ['Cancel', false, 'Import from MoneyLover cancelled.'],
  ['Create separate categories', true, '2 transactions imported.'],
] as const)(
  'Mixed Category confirmation forwards %s and handles cancellation rejection',
  async (choice, accepted, message) => {
    const user = userEvent.setup();
    const decision = jest.fn();
    jest.mocked(importMoneyLoverFile).mockImplementation(async (confirm) => {
      const answer = await confirm!(['Other']);
      decision(answer);
      if (!answer) throw new Error('Mixed Categories require confirmation');
      return 2;
    });
    await render(<SettingsDataActions />);
    await user.press(screen.getByRole('button', { name: 'Import from MoneyLover' }));

    expect(alert).toHaveBeenCalledWith(
      'Mixed categories',
      expect.stringContaining('Other'),
      expect.any(Array),
      { cancelable: false },
    );
    await chooseAlert(choice);

    expect(decision).toHaveBeenCalledWith(accepted);
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  },
);

test.each([
  [0, '0 transactions imported.'],
  [1, '1 transaction imported.'],
  [7, '7 transactions imported.'],
])('import reports the completed count of %i', async (count, message) => {
  const user = userEvent.setup();
  jest.mocked(importMoneyLoverFile).mockResolvedValue(count);
  await render(<SettingsDataActions />);
  await user.press(screen.getByRole('button', { name: 'Import from MoneyLover' }));
  expect(await screen.findByText(message)).toBeOnTheScreen();
});

test('CSV export failure can be retried without restarting a different operation', async () => {
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
  expect(importMoneyLoverFile).not.toHaveBeenCalled();
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
