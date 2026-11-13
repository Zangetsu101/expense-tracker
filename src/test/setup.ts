import { act } from 'react';
import { notifyManager } from '@tanstack/react-query';
import type * as TestRenderer from 'test-renderer';

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

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

// TanStack Query gives results to its observers from a timer. Without `act`, a result
// that arrives after the last step of a test causes a React warning in some runs.
// `waitFor` and `findBy*` turn the act environment off while they poll. React gives
// no warning then, and a call to `act` would cause one.
notifyManager.setNotifyFunction((notify) => {
  if (actEnvironment.IS_REACT_ACT_ENVIRONMENT) act(notify);
  else notify();
});
