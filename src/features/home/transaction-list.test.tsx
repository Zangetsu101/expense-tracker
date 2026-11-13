import { cleanup, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { AnimationClockProvider } from '@/components/animation-clock';
import { TransactionList } from './transaction-list.tsx';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {},
  statusCodes: {},
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => false,
  useTimestamp: () => jest.requireActual('react-native-reanimated/mock').useSharedValue(0),
}));

const activity = (pending: boolean, label = 'Current results') => (
  <AnimationClockProvider>
    <TransactionList
      sections={[]}
      header={<Text>Account activity</Text>}
      footer={
        <Pressable accessibilityRole="button" accessibilityLabel={label}>
          <Text>{label}</Text>
        </Pressable>
      }
      scope={{ face: 'pace', accountId: null }}
      now={new Date(2026, 10, 12)}
      query=""
      muted={pending}
      slidingId={null}
      phase={() => undefined}
      onOpen={() => {}}
    />
  </AnimationClockProvider>
);
beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
});

test('stale results are hidden from interaction and accessibility immediately', async () => {
  await render(activity(true));
  expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Current results', includeHiddenElements: true }),
  ).toBeOnTheScreen();
});

test('fresh results become interactive independently of the visual hold', async () => {
  const view = await render(activity(true));
  await view.rerender(activity(false, 'Fresh results'));
  expect(screen.getByRole('button', { name: 'Fresh results' })).toBeOnTheScreen();
});
