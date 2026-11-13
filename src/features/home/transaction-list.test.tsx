import { act, cleanup, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
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
}));

const activity = (pending: boolean, label = 'Current results') => (
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
);
const presentation = () => screen.getByRole('button', { includeHiddenElements: true }).parent!;
const advance = async (ms: number) => {
  await act(async () => jest.advanceTimersByTime(ms));
};

beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
});

test('updates completed before 100 ms never dim, and cancel their pending delay', async () => {
  const view = await render(activity(true));
  await advance(99);
  expect(presentation()).toHaveStyle({ opacity: 1 });
  await view.rerender(activity(false));
  await advance(1000);
  expect(presentation()).toHaveStyle({ opacity: 1 });
  expect(screen.getByRole('button', { name: 'Current results' })).toBeOnTheScreen();
});

test('dimming starts at 100 ms and lasts 400 ms while fresh results become interactive', async () => {
  const view = await render(activity(true));
  await advance(100);
  expect(presentation()).toHaveStyle({ opacity: 0.4 });
  expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  await advance(80);
  await view.rerender(activity(false, 'Fresh results'));
  expect(screen.getByRole('button', { name: 'Fresh results' })).toBeOnTheScreen();
  expect(presentation()).toHaveStyle({ opacity: 0.4 });
  await advance(319);
  expect(presentation()).toHaveStyle({ opacity: 0.4 });
  await advance(1);
  expect(presentation()).toHaveStyle({ opacity: 1 });
});

test('a slow update stays dim until ready without another minimum hold', async () => {
  const view = await render(activity(true));
  await advance(100);
  await advance(550);
  expect(presentation()).toHaveStyle({ opacity: 0.4 });
  await view.rerender(activity(false));
  await advance(0);
  expect(presentation()).toHaveStyle({ opacity: 1 });
});

test('a new update during the minimum hold keeps the list dim until ready', async () => {
  const view = await render(activity(true));
  await advance(100);
  await view.rerender(activity(false));
  await advance(100);
  await view.rerender(activity(true));
  await advance(400);
  expect(presentation()).toHaveStyle({ opacity: 0.4 });
  expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  await view.rerender(activity(false));
  await advance(0);
  expect(presentation()).toHaveStyle({ opacity: 1 });
  await view.rerender(activity(true));
  await advance(99);
  expect(presentation()).toHaveStyle({ opacity: 1 });
  await advance(1);
  expect(presentation()).toHaveStyle({ opacity: 0.4 });
});
