import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import * as Updates from 'expo-updates';
import { AppUpdatesProvider, UpdatesRow } from './app-updates';

let mockFocus: () => void;
jest.mock('expo-router', () => ({
  useFocusEffect: (focus: () => void) => {
    mockFocus = focus;
  },
}));
jest.mock('expo-constants', () => ({ executionEnvironment: 'standalone' }));
jest.mock('expo-updates', () => ({
  isEnabled: true,
  UpdateCheckResultNotAvailableReason:
    jest.requireActual('expo-updates').UpdateCheckResultNotAvailableReason,
  useUpdates: jest.fn(),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));
const tree = (visible = true) => (
  <AppUpdatesProvider>{visible && <UpdatesRow />}</AppUpdatesProvider>
);
const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const originalDev = runtime.__DEV__;
type NativeUpdates = ReturnType<typeof Updates.useUpdates>;
const mockNative: NativeUpdates = {
  currentlyRunning: {
    isEmbeddedLaunch: true,
    isEmergencyLaunch: false,
    emergencyLaunchReason: null,
  },
  isUpdateAvailable: false,
  restartCount: 0,
  isStartupProcedureRunning: false,
  isChecking: false,
  isDownloading: false,
  isUpdatePending: false,
  isRestarting: false,
  downloadProgress: undefined,
};
beforeEach(() => {
  runtime.__DEV__ = false;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.mocked(Updates.useUpdates).mockImplementation(() => ({ ...mockNative }));
});
afterEach(() => {
  runtime.__DEV__ = originalDev;
  jest.restoreAllMocks();
});

test('startup owns the check, download exposes progress, and restart requires confirmation', async () => {
  const user = userEvent.setup();
  const native = { ...mockNative, isStartupProcedureRunning: true };
  jest.mocked(Updates.useUpdates).mockImplementation(() => ({ ...native }));
  const view = await render(tree());
  expect(screen.getByRole('button', { name: 'Checking for updates' })).toBeDisabled();
  expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  Object.assign(native, {
    isStartupProcedureRunning: false,
    isDownloading: true,
    isUpdatePending: true,
  });
  for (const percent of [0, 37, 50, 100]) {
    native.downloadProgress = percent / 100;
    await view.rerender(tree());
    expect(screen.getByRole('button', { name: `Downloading update, ${percent}%` })).toBeDisabled();
    expect(screen.getByLabelText('Downloading update')).toHaveAccessibilityValue({ now: percent });
  }
  native.downloadProgress = undefined;
  await view.rerender(tree());
  expect(screen.getByRole('button', { name: 'Downloading update' })).toBeDisabled();
  native.isDownloading = false;
  await view.rerender(tree());
  await act(mockFocus);
  await user.press(screen.getByRole('button', { name: 'Restart to update' }));
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
  const [, warning, buttons] = jest.mocked(Alert.alert).mock.lastCall!;
  expect(warning).toMatch(/Unsaved/);
  expect(buttons).toContainEqual(expect.objectContaining({ style: 'cancel' }));
  await act(() => buttons?.find((b) => b.text === 'Restart to update')?.onPress?.());
  expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(jest.mocked(AppState.addEventListener).mock.results[0].value.remove).toHaveBeenCalled();
});

test('failed checks can be retried and revisiting clears visit-specific feedback', async () => {
  const user = userEvent.setup();
  jest.mocked(Updates.checkForUpdateAsync).mockRejectedValue(new Error('offline'));
  const view = await render(tree());
  await user.press(screen.getByRole('button', { name: 'Check for updates' }));
  expect(screen.getByRole('button', { name: 'Update failed. Tap to retry' })).toBeEnabled();
  expect(Alert.alert).toHaveBeenCalledWith('Update failed', expect.stringMatching(/connection/));
  await act(mockFocus);
  expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
  await view.rerender(tree(false));
  await view.rerender(tree());
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  jest.mocked(Updates.checkForUpdateAsync).mockResolvedValue({
    isAvailable: false,
    isRollBackToEmbedded: false,
    manifest: undefined,
    reason: Updates.UpdateCheckResultNotAvailableReason.NO_UPDATE_AVAILABLE_ON_SERVER,
  });
  await user.press(screen.getByRole('button', { name: 'Check for updates' }));
  expect(screen.getByRole('button', { name: 'Up to date' })).toBeEnabled();
  await act(mockFocus);
  expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
});
test('development builds explain why updates are unavailable', async () => {
  runtime.__DEV__ = true;
  const user = userEvent.setup();
  await render(tree());
  await user.press(screen.getByRole('button', { name: /installed release build/ }));
  expect(Alert.alert).toHaveBeenCalledWith('Updates', expect.stringMatching(/release build/));
  expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
});
