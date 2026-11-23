import { act, render, screen, userEvent } from '@testing-library/react-native';
import { openDatabaseAsync } from 'expo-sqlite';
import { Text } from 'react-native';
import { database } from '@/lib/database';
import { openLedger } from '@/lib/legs-migration';
import { DatabaseGate } from './database-gate';

// The real database() cache runs. Only the native database and the migration are fakes.
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('@/lib/legs-migration', () => ({ openLedger: jest.fn() }));

/** The next open attempt. The test settles it. */
function nextAttempt() {
  let settle!: { resolve: () => void; reject: (error: Error) => void };
  jest.mocked(openLedger).mockImplementationOnce(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );
  return () => settle;
}

test('a failed open shows the error and opens again only after Try again', async () => {
  const user = userEvent.setup();
  jest.mocked(openDatabaseAsync).mockResolvedValue({
    runAsync: jest.fn(async () => ({ changes: 0, lastInsertRowId: 0 })),
  } as never);
  const first = nextAttempt();
  await render(
    <DatabaseGate>
      <Text>Home screen</Text>
    </DatabaseGate>,
  );
  expect(screen.getByText('Opening your data…')).toBeOnTheScreen();
  expect(screen.queryByText('Home screen')).not.toBeOnTheScreen();

  await act(async () => first().reject(new Error('Foreign key violations: [split_shares]')));
  expect(
    screen.getByRole('header', { name: 'The app could not open your data' }),
  ).toBeOnTheScreen();
  expect(screen.getByText('Foreign key violations: [split_shares]')).toBeOnTheScreen();
  expect(screen.getByText(/stopped the update and kept the data as it was/)).toBeOnTheScreen();
  expect(screen.queryByText('Home screen')).not.toBeOnTheScreen();
  // The error render and a background task get the same failure, and nothing opens again.
  await expect(database()).rejects.toThrow('Foreign key violations');
  expect(openLedger).toHaveBeenCalledTimes(1);

  const second = nextAttempt();
  await user.press(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByText('Opening your data…')).toBeOnTheScreen();
  expect(openLedger).toHaveBeenCalledTimes(2);
  await act(async () => second().resolve());
  expect(screen.getByText('Home screen')).toBeOnTheScreen();
  expect(openLedger).toHaveBeenCalledTimes(2);
});
