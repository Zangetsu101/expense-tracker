import { act, render, screen, userEvent, within } from '@testing-library/react-native';
import { useFocusEffect } from 'expo-router';
import * as Updates from 'expo-updates';
import { Alert, AppState } from 'react-native';
import { AppUpdatesProvider, UpdatesRow } from './app-updates';

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn((callback) =>
    jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
  ),
}));
jest.mock('expo-constants', () => ({ executionEnvironment: 'standalone' }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('expo-updates', () => ({
  isEnabled: true,
  UpdateCheckResultNotAvailableReason: {
    NO_UPDATE_AVAILABLE_ON_SERVER: 'noUpdateAvailableOnServer',
  },
  useUpdates: jest.fn(),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

const idle: ReturnType<typeof Updates.useUpdates> = {
  currentlyRunning: {
    isEmbeddedLaunch: true,
    isEmergencyLaunch: false,
    emergencyLaunchReason: null,
  },
  isStartupProcedureRunning: false,
  isUpdateAvailable: false,
  isUpdatePending: false,
  isChecking: false,
  isDownloading: false,
  isRestarting: false,
  restartCount: 0,
};
const noUpdate = {
  isAvailable: false,
  isRollBackToEmbedded: false,
  manifest: undefined,
  reason: Updates.UpdateCheckResultNotAvailableReason.NO_UPDATE_AVAILABLE_ON_SERVER,
} as const;
const check = jest.mocked(Updates.checkForUpdateAsync);
const native = jest.mocked(Updates.useUpdates);
const button = (name: string) => screen.getByRole('button', { name });

function tree(showRow = true) {
  return <AppUpdatesProvider>{showRow && <UpdatesRow />}</AppUpdatesProvider>;
}

async function focus() {
  const onFocus = jest.mocked(useFocusEffect).mock.lastCall?.[0];
  expect(onFocus).toBeDefined();
  await act(async () => {
    onFocus?.();
  });
}

const environment = globalThis as typeof globalThis & { __DEV__: boolean };
let previousDev: boolean;
beforeEach(() => {
  previousDev = __DEV__;
  environment.__DEV__ = false;
  native.mockReturnValue(idle);
  check.mockReset().mockResolvedValue(noUpdate);
  jest.mocked(Updates.reloadAsync).mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  environment.__DEV__ = previousDev;
  jest.restoreAllMocks();
});

test('waits for native startup and reports native download progress', async () => {
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
  native.mockReturnValue({ ...idle, isStartupProcedureRunning: true });
  const { rerender, unmount } = await render(tree());
  expect(button('Checking for updates')).toBeDisabled();
  expect(check).not.toHaveBeenCalled();

  for (const progress of [0.37, 0, 0.5, 1]) {
    native.mockReturnValue({ ...idle, isDownloading: true, downloadProgress: progress });
    await rerender(tree());
    expect(button(`Downloading update, ${Math.round(progress * 100)}%`)).toBeDisabled();
    expect(screen.getByLabelText('Downloading update')).toHaveAccessibilityValue({
      now: Math.round(progress * 100),
    });
  }
  native.mockReturnValue({ ...idle, isDownloading: true });
  await rerender(tree());
  expect(button('Downloading update')).toBeDisabled();
  expect(
    within(button('Downloading update')).getByLabelText('Downloading update'),
  ).toBeOnTheScreen();

  native.mockReturnValue({ ...idle, isUpdatePending: true });
  await rerender(tree());
  expect(check).toHaveBeenCalledTimes(1);
  expect(button('Restart to update')).toBeEnabled();
  await unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('checks again when Settings regains focus and restores the cached restart on failure', async () => {
  const user = userEvent.setup();
  native.mockReturnValue({ ...idle, isUpdatePending: true });
  await render(tree());
  expect(button('Restart to update')).toBeEnabled();
  expect(check).toHaveBeenCalledTimes(1);

  const result = Promise.withResolvers<Awaited<ReturnType<typeof check>>>();
  check.mockReturnValueOnce(result.promise);
  await focus();
  expect(check).toHaveBeenCalledTimes(2);
  expect(button('Checking for updates')).toBeBusy();
  expect(button('Checking for updates')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Restart to update' })).toBeNull();

  await act(async () => result.reject(Error('offline')));
  expect(Alert.alert).not.toHaveBeenCalled();
  await user.press(button('Restart to update'));
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
  const [title, message, choices] = jest.mocked(Alert.alert).mock.lastCall ?? [];
  expect(title).toBe('Restart to update?');
  expect(message).toMatch(/Unsaved/);
  expect(choices?.[0]?.style).toBe('cancel');
  await act(async () => choices?.find(({ text }) => text === 'Restart to update')?.onPress?.());
  expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
});

test('manual errors are actionable and their status clears on the next visit', async () => {
  const user = userEvent.setup();
  check.mockRejectedValue(Error('offline'));
  const { rerender } = await render(tree());
  expect(Alert.alert).not.toHaveBeenCalled();
  await user.press(button('Check for updates'));
  expect(button('Update failed. Tap to retry')).toBeEnabled();
  expect(Alert.alert).toHaveBeenCalledWith('Update failed', expect.stringContaining('connection'));
  await focus();
  expect(button('Check for updates')).toBeEnabled();
  await rerender(tree(false));
  await rerender(tree());
  expect(button('Check for updates')).toBeEnabled();
  expect(Alert.alert).toHaveBeenCalledTimes(1);

  check.mockResolvedValue(noUpdate);
  await user.press(button('Check for updates'));
  expect(button('Up to date')).toBeEnabled();
  await focus();
  expect(button('Check for updates')).toBeEnabled();
});

test('development builds explain that updates require an installed release build', async () => {
  const user = userEvent.setup();
  environment.__DEV__ = true;
  await render(tree());
  const label = 'Updates are available in an installed release build.';
  await user.press(button(label));
  expect(Alert.alert).toHaveBeenCalledWith('Updates', label);
  expect(check).not.toHaveBeenCalled();
});
