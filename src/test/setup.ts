import type * as TestRenderer from 'test-renderer';

// Reanimated 4.7's mock imports native CSS initialization, which requires a UI runtime.
jest.mock('react-native-reanimated/src/initializers', () => ({
  initializeReanimatedModule: jest.fn(),
}));

// Touchable dispatches native button events, which userEvent cannot synthesize.
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  const { Pressable } = jest.requireActual('react-native');
  return new Proxy(actual, {
    get: (target, name) => (name === 'Touchable' ? Pressable : Reflect.get(target, name)),
  });
});

// The test renderer logs each error that an error boundary catches, with the full React
// fiber. A test for an error fallback asserts the fallback, so the log adds nothing.
// React still logs an error that no boundary catches.
jest.mock('test-renderer', () => {
  const actual = jest.requireActual<typeof TestRenderer>('test-renderer');
  return {
    ...actual,
    createRoot: (options?: TestRenderer.RootOptions) =>
      actual.createRoot({ onCaughtError: () => {}, ...options }),
  };
});
