import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { database } from '@/lib/database';
import { DatabaseGate } from './database-gate';

jest.mock('@/lib/database', () => ({ database: jest.fn() }));

/**
 * A database() call that the test settles. Like database(), it gives the same promise until
 * the promise fails.
 */
function pendingOpen() {
  let settle!: { resolve: () => void; reject: (error: Error) => void };
  const promise = new Promise((resolve, reject) => {
    settle = { resolve: () => resolve({} as never), reject };
  });
  promise.catch(() => {});
  jest.mocked(database).mockImplementation(() => promise as never);
  return () => settle;
}

const app = (
  <DatabaseGate>
    <Text>Home screen</Text>
  </DatabaseGate>
);

test('the app shows its screens only after the database opens', async () => {
  const open = pendingOpen();
  await render(app);
  expect(screen.getByText('Opening your data…')).toBeOnTheScreen();
  expect(screen.queryByText('Home screen')).not.toBeOnTheScreen();
  await act(async () => open().resolve());
  expect(screen.getByText('Home screen')).toBeOnTheScreen();
});

test('a failed update shows the error, keeps the screens closed, and can try again', async () => {
  const user = userEvent.setup();
  const first = pendingOpen();
  await render(app);
  await act(async () => first().reject(new Error('Foreign key violations: [split_shares]')));
  expect(
    screen.getByRole('header', { name: 'The app could not open your data' }),
  ).toBeOnTheScreen();
  expect(screen.getByText('Foreign key violations: [split_shares]')).toBeOnTheScreen();
  expect(screen.getByText(/stopped the update and kept the data as it was/)).toBeOnTheScreen();
  expect(screen.queryByText('Home screen')).not.toBeOnTheScreen();

  const second = pendingOpen();
  await user.press(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Opening your data…')).toBeOnTheScreen();
  await act(async () => second().resolve());
  expect(screen.getByText('Home screen')).toBeOnTheScreen();
});
