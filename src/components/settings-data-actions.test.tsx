import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { exportBackup, restoreBackup } from '@/lib/backup';
import { exportTransactionsCsv } from '@/lib/export-csv';
import { importMoneyLoverFile } from '@/lib/import-csv';
import { SettingsDataActions } from './settings-data-actions';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('@/lib/backup-adapter', () => ({ backupStore: {}, backupDocuments: {} }));
jest.mock('@/lib/backup', () => ({ exportBackup: jest.fn(), restoreBackup: jest.fn() }));
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

test.each([
  ['Cancel', false, 'Restore from file cancelled.'],
  ['Replace data', true, 'Backup restored. Current data has been replaced.'],
] as const)(
  'restore confirmation forwards %s for the validated filename',
  async (choice, accepted, message) => {
    const user = userEvent.setup();
    const decision = jest.fn();
    jest.mocked(restoreBackup).mockImplementation(async (_store, _documents, confirm) => {
      const answer = await confirm('saved.json');
      decision(answer);
      return answer;
    });
    await render(<SettingsDataActions />);
    await user.press(screen.getByRole('button', { name: 'Restore from file' }));

    expect(alert).toHaveBeenCalledWith(
      'Replace all current data?',
      expect.stringContaining('Selected: saved.json'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Replace data', style: 'destructive' }),
      ]),
      { cancelable: false },
    );
    expect(screen.getByRole('button', { name: 'Restore from file' })).toBeBusy();
    expect(decision).not.toHaveBeenCalled();
    await chooseAlert(choice);

    expect(decision).toHaveBeenCalledWith(accepted);
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Restore from file' })).toBeEnabled();
  },
);

test('restore failure stays visible and Retry clears the error after completion', async () => {
  const user = userEvent.setup();
  jest
    .mocked(restoreBackup)
    .mockRejectedValueOnce(new Error('Invalid backup'))
    .mockResolvedValueOnce(true);
  await render(<SettingsDataActions />);
  await user.press(screen.getByRole('button', { name: 'Restore from file' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Restore from file failed. Invalid backup',
  );
  expect(alert).not.toHaveBeenCalled();
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(
    await screen.findByText('Backup restored. Current data has been replaced.'),
  ).toBeOnTheScreen();
  expect(restoreBackup).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen();
});

test('pending work blocks duplicate actions and leaving, and reports success only after completion', async () => {
  const user = userEvent.setup();
  const onBusyChange = jest.fn();
  const completion = Promise.withResolvers<string | null>();
  jest.mocked(exportBackup).mockReturnValue(completion.promise);
  await render(<SettingsDataActions onBusyChange={onBusyChange} />);
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  await user.press(screen.getByRole('button', { name: 'Create backup' }));

  expect(screen.getByRole('button', { name: 'Create backup' })).toBeBusy();
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  expect(screen.getByText('Create backup in progress…')).toBeOnTheScreen();
  expect(screen.queryByText('Backup saved.')).not.toBeOnTheScreen();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  await user.press(screen.getByRole('button', { name: 'Create backup' }));
  await user.press(screen.getByRole('button', { name: 'Export transactions CSV' }));
  expect(exportBackup).toHaveBeenCalledTimes(1);
  expect(exportTransactionsCsv).not.toHaveBeenCalled();

  const navigation = jest.mocked(usePreventRemove).mock.calls.at(-1)!;
  expect(navigation[0]).toBe(true);
  await act(async () => navigation[1]({ data: { action: { type: 'GO_BACK' } } }));
  expect(alert).toHaveBeenCalledWith(
    'Operation in progress',
    expect.stringContaining('before leaving'),
  );

  await act(async () => completion.resolve('content://backup'));
  expect(await screen.findByText('Backup saved.')).toBeOnTheScreen();
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  expect(jest.mocked(usePreventRemove).mock.calls.at(-1)?.[0]).toBe(false);
  for (const button of screen.getAllByRole('button')) expect(button).toBeEnabled();
});

test.each([
  ['Create backup', 'Backup saved.'],
  ['Export transactions CSV', 'Transactions CSV exported.'],
  ['Import from MoneyLover', '0 transactions imported.'],
  ['Restore from file', 'Backup restored. Current data has been replaced.'],
])('cancelling %s never reports success', async (label, success) => {
  const user = userEvent.setup();
  jest.mocked(exportBackup).mockResolvedValue(null);
  jest.mocked(exportTransactionsCsv).mockResolvedValue(null);
  jest.mocked(importMoneyLoverFile).mockResolvedValue(null);
  jest.mocked(restoreBackup).mockResolvedValue(false);
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
  expect(exportBackup).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
});

test('CSV export remains pending until the file operation completes', async () => {
  const user = userEvent.setup();
  const completion = Promise.withResolvers<string | null>();
  jest.mocked(exportTransactionsCsv).mockReturnValue(completion.promise);
  await render(<SettingsDataActions />);
  await user.press(screen.getByRole('button', { name: 'Export transactions CSV' }));

  expect(screen.getByRole('button', { name: 'Export transactions CSV' })).toBeBusy();
  expect(screen.queryByText('Transactions CSV exported.')).not.toBeOnTheScreen();
  await act(async () => completion.resolve('content://csv'));

  expect(await screen.findByText('Transactions CSV exported.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Export transactions CSV' })).toBeEnabled();
});
