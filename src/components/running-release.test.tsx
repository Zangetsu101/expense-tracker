import { render, screen, userEvent } from '@testing-library/react-native';
import { TurboModuleRegistry } from 'react-native';
import { RunningRelease } from './running-release';

jest.mock('@/components/app-sheet', () => jest.requireActual('./app-sheet.tsx'));

jest.mock('expo-constants', () => ({
  executionEnvironment: 'standalone',
  expoConfig: { version: '0.1.0' },
}));
jest.mock('expo-updates', () => ({
  isEnabled: true,
  updateId: 'running-id',
  createdAt: new Date('2026-11-05Z'),
  runtimeVersion: '0.1.0',
  channel: 'production',
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  emergencyLaunchReason: null,
}));

afterEach(() => jest.restoreAllMocks());

async function openRelease() {
  const user = userEvent.setup();
  await render(<RunningRelease />);
  expect(screen.queryByRole('header', { name: 'Running release' })).toBeNull();
  await user.press(screen.getByRole('button', { name: /^Version 0\.1\.0 ·/ }));
  return user;
}

test('copies the selectable details of the running release', async () => {
  const user = await openRelease();
  const details = screen.getByText(/Update ID: running-id/);
  expect(details).toHaveProp('selectable', true);
  const setString = jest.fn();
  const nativeClipboard = { setString, getConstants: () => ({}) };
  const clipboard = jest.spyOn(TurboModuleRegistry, 'get').mockReturnValueOnce(nativeClipboard);
  await user.press(screen.getByRole('button', { name: 'Copy details' }));
  expect(clipboard).toHaveBeenCalledWith('Clipboard');
  expect(setString).toHaveBeenCalledWith(details.props.children);
  expect(screen.getByRole('alert')).toHaveTextContent('Details copied.');
});

test.each(['missing', 'throws'] as const)(
  'explains manual copying when the clipboard %s and clears feedback on dismissal',
  async (failure) => {
    const user = await openRelease();
    const clipboard =
      failure === 'missing'
        ? null
        : {
            getConstants: () => ({}),
            setString() {
              throw Error('unavailable');
            },
          };
    jest.spyOn(TurboModuleRegistry, 'get').mockReturnValueOnce(clipboard);
    await user.press(screen.getByRole('button', { name: 'Copy details' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Select all and Copy/);
    await user.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('header', { name: 'Running release' })).toBeNull();
    await user.press(screen.getByRole('button', { name: /^Version 0\.1\.0 ·/ }));
    expect(screen.getByRole('header', { name: 'Running release' })).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).toBeNull();
    await user.press(screen.getByRole('button', { name: 'Dismiss sheet' }));
    expect(screen.queryByRole('header', { name: 'Running release' })).toBeNull();
  },
);
