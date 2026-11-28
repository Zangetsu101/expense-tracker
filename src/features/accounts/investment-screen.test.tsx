import { act, screen, userEvent } from '@testing-library/react-native';
import { epochDay } from '@/lib/database';
import { investmentHistory } from '@/lib/investments';
import { createQueryClient } from '@/lib/query-client';
import { accountBalances } from '@/lib/reports';
import { renderWithQueries } from '@/test/render-with-queries';
import { InvestmentScreen } from './investment-screen';
import { accountsOverviewQuery, type AccountsOverview } from './queries';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ accountId: '1' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
jest.mock('@/components/app-sheet', () => ({
  AppSheet: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/investments', () => ({
  ...jest.requireActual<typeof import('@/lib/investments')>('@/lib/investments'),
  investmentHistory: jest.fn(async () => []),
}));
jest.mock('@/lib/reports', () => ({ accountBalances: jest.fn() }));

function cachedOverview() {
  const today = epochDay(new Date());
  const client = createQueryClient();
  const overview = {
    accounts: [
      {
        id: 1,
        name: 'Fund',
        currencyCode: 'USD',
        openingBalanceMinor: 10000,
        isFavorite: 0,
        isInvestment: 1,
      },
    ],
    balances: new Map([[1, 10000]]),
    bills: [],
    investments: [
      { id: 1, currencyCode: 'USD', investedMinor: 10000, growthMinor: 0, dividends: [] },
    ],
    rate: null,
  } satisfies AccountsOverview;
  client.setQueryDefaults(['accounts', 'overview'], { staleTime: Infinity });
  client.setQueryData(accountsOverviewQuery(today).queryKey, overview);
  return { client, today };
}

const balance = { id: 1, name: 'Fund', currencyCode: 'USD', balanceMinor: 10000 };

test('Investment detail shows disabled actions until the reads finish', async () => {
  const { client } = cachedOverview();
  const history = Promise.withResolvers<Awaited<ReturnType<typeof investmentHistory>>>();
  jest.mocked(investmentHistory).mockReturnValueOnce(history.promise);
  await renderWithQueries(<InvestmentScreen />, client);

  try {
    expect(
      await screen.findByRole('progressbar', { name: 'Loading investment' }),
    ).toBeOnTheScreen();
    expect(screen.getByText('Current value')).toBeOnTheScreen();
    expect(screen.getByText('History')).toBeOnTheScreen();
    expect(screen.getByText('Add a liquid Account to receive dividends.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Update value' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dividend' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeDisabled();
  } finally {
    await act(async () => history.resolve([]));
  }
  expect(await screen.findByRole('button', { name: 'Update value' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Dividend' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Transfer' })).toBeEnabled();
  expect(screen.queryByRole('progressbar', { name: 'Loading investment' })).toBeNull();
});

test('Save value stays disabled while the balance loads and the draft stays editable', async () => {
  const { client } = cachedOverview();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof accountBalances>>>();
  jest.mocked(accountBalances).mockReturnValueOnce(pending.promise);
  const user = userEvent.setup();
  await renderWithQueries(<InvestmentScreen />, client);
  await user.press(await screen.findByRole('button', { name: 'Update value' }));

  try {
    expect(await screen.findByRole('progressbar', { name: 'Loading balance' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save value' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Yesterday' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    const input = screen.getByLabelText('New total');
    await user.clear(input);
    await user.type(input, '120');
  } finally {
    await act(async () => pending.resolve([balance]));
  }
  expect(await screen.findByText('+$20.00')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Save value' })).toBeEnabled();
  expect(screen.getByLabelText('New total')).toHaveDisplayValue('120');
});

test('a failed balance refresh uses the sheet fallback and retry keeps the draft', async () => {
  const { client, today } = cachedOverview();
  const read = jest.mocked(accountBalances);
  read.mockResolvedValueOnce([balance]);
  const user = userEvent.setup();
  await renderWithQueries(<InvestmentScreen />, client);
  await user.press(await screen.findByRole('button', { name: 'Update value' }));
  const input = screen.getByLabelText('New total');
  await user.clear(input);
  await user.type(input, '120');
  expect(await screen.findByRole('button', { name: 'Save value' })).toBeEnabled();

  read.mockRejectedValueOnce(new Error('Balance unavailable'));
  await act(() => client.refetchQueries({ queryKey: ['accounts', 'balances', today] }));
  expect(await screen.findByText('Could not load the balance.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Save value' })).toBeNull();
  expect(screen.getByLabelText('New total')).toHaveDisplayValue('120');
  expect(screen.getByRole('button', { name: 'Yesterday' })).toBeEnabled();

  read.mockResolvedValueOnce([{ ...balance, balanceMinor: 11000 }]);
  await user.press(screen.getByRole('button', { name: 'Retry balance' }));
  expect(await screen.findByText('+$10.00')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Save value' })).toBeEnabled();
});
