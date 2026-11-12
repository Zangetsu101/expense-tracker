import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import type { AppSheetProps } from '@/components/app-sheet';
import { listManagedAccounts, type ManagedAccount } from '@/lib/accounts';
import { monthlyReport } from '@/lib/reports';
import { refreshQueries, renderWithQueries } from '@/test/render-with-queries';
import { ReportsScreen } from './index';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/app-sheet', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { AppSheet: ({ children }: AppSheetProps) => <View>{children}</View> };
});
jest.mock('@/lib/accounts', () => ({ listManagedAccounts: jest.fn() }));
jest.mock('@/lib/reports', () => ({ monthlyReport: jest.fn() }));

type Report = Awaited<ReturnType<typeof monthlyReport>>;

const cash: ManagedAccount = {
  id: 7,
  name: 'Cash',
  currencyCode: 'USD',
  openingBalanceMinor: 0,
  isFavorite: 0,
};
const bank: ManagedAccount = {
  id: 8,
  name: 'Bank',
  currencyCode: 'EUR',
  openingBalanceMinor: 0,
  isFavorite: 0,
};
const report = (income = 12000, expense = 3500): Report => ({
  summaries: [
    { currencyCode: 'USD', incomeMinor: income, expenseMinor: expense },
    { currencyCode: 'EUR', incomeMinor: 900, expenseMinor: 200 },
  ],
  spending: [{ currencyCode: 'USD', categoryId: 1, categoryName: 'Food', amountMinor: expense }],
});

const year = 2026;
const month = 3;
const otherMonth = 'January';
const otherMonthNumber = 1;

beforeAll(() => {
  // The screen starts in the month of the clock. Fix the clock and keep the real timers.
  jest.useFakeTimers({
    now: new Date(year, month - 1, 15),
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'nextTick',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'performance',
      'hrtime',
    ],
  });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.mocked(listManagedAccounts).mockReset();
  jest.mocked(monthlyReport).mockReset();
});

async function renderScreen() {
  const view = await renderWithQueries(<ReportsScreen />);
  return view;
}

/** Each report read gets a deferred result that the test resolves or rejects. */
function reportReads() {
  const reads: { args: Parameters<typeof monthlyReport>; read: PromiseWithResolvers<Report> }[] =
    [];
  jest.mocked(monthlyReport).mockImplementation((...args) => {
    const read = Promise.withResolvers<Report>();
    reads.push({ args, read });
    return read.promise;
  });
  return reads;
}

async function chooseCash(user: ReturnType<typeof userEvent.setup>) {
  await user.press(screen.getByRole('button', { name: 'Choose account scope, All accounts' }));
  await user.press(screen.getByRole('radio', { name: 'Cash · USD' }));
}

test('first load shows a skeleton and then the report, and the month controls stay usable', async () => {
  const user = userEvent.setup();
  const accounts = Promise.withResolvers<ManagedAccount[]>();
  jest.mocked(listManagedAccounts).mockReturnValue(accounts.promise);
  jest.mocked(monthlyReport).mockResolvedValue(report());
  await renderScreen();

  expect(screen.getByLabelText('Loading reports')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: `${otherMonth} ${year}` }));
  expect(screen.getByRole('button', { name: `${otherMonth} ${year}` })).toBeSelected();

  await act(async () => accounts.resolve([cash, bank]));
  expect(await screen.findByLabelText('Income, EUR 9.00')).toBeOnTheScreen();
  expect(screen.getByLabelText('Income, USD 120.00')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Loading reports')).not.toBeOnTheScreen();
  expect(monthlyReport).toHaveBeenLastCalledWith(year, otherMonthNumber, undefined);
});

test('the account scope drives the read and the visible currency totals', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
  jest
    .mocked(monthlyReport)
    .mockImplementation(async (_year, _month, scope) =>
      scope === 7 ? report(5000, 1250) : report(),
    );
  await renderScreen();
  expect(await screen.findByLabelText('Income, EUR 9.00')).toBeOnTheScreen();

  await chooseCash(user);

  expect(await screen.findByLabelText('Income, USD 50.00')).toBeOnTheScreen();
  expect(monthlyReport).toHaveBeenLastCalledWith(year, month, 7);
  expect(
    screen.getByRole('button', { name: 'Choose account scope, Cash · USD' }),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('Expense, USD -12.50')).toBeOnTheScreen();
  expect(screen.getByLabelText('Net, USD 37.50')).toBeOnTheScreen();
  expect(screen.queryByText('EUR report')).not.toBeOnTheScreen();
  expect(screen.getByText('100.0% of spending')).toBeOnTheScreen();
});

test('year navigation and a corrected year keep the month and the account scope', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
  jest.mocked(monthlyReport).mockResolvedValue(report());
  await renderScreen();
  await screen.findByLabelText('Income, EUR 9.00');

  await user.press(screen.getByRole('button', { name: `September ${year}` }));
  await chooseCash(user);
  await user.press(screen.getByRole('button', { name: 'Next year' }));
  await waitFor(() => expect(monthlyReport).toHaveBeenLastCalledWith(year + 1, 9, 7));
  await user.press(screen.getByRole('button', { name: 'Previous year' }));
  expect(screen.getByText(`September ${year}`)).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Choose account scope, Cash · USD' }),
  ).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: `Choose report year, ${year}` }));
  const calls = jest.mocked(monthlyReport).mock.calls.length;
  await user.clear(screen.getByLabelText('Report year'));
  await user.type(screen.getByLabelText('Report year'), '0');
  await user.press(screen.getByRole('button', { name: 'Go to year' }));
  expect(screen.getByText('Enter a year from 1 to 9999.')).toBeOnTheScreen();
  expect(monthlyReport).toHaveBeenCalledTimes(calls);

  await user.clear(screen.getByLabelText('Report year'));
  await user.type(screen.getByLabelText('Report year'), '2025');
  await user.press(screen.getByRole('button', { name: 'Go to year' }));
  await waitFor(() => expect(monthlyReport).toHaveBeenLastCalledWith(2025, 9, 7));
  expect(screen.queryByLabelText('Report year')).not.toBeOnTheScreen();
  expect(screen.getByText('September 2025')).toBeOnTheScreen();
});

test('a failed report read shows an error, and Retry reads again', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
  jest.mocked(monthlyReport).mockRejectedValueOnce(new Error('Database unavailable'));
  await renderScreen();

  expect(await screen.findByText('Could not load the report.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Choose account scope, All accounts' })).toBeEnabled();
  jest.mocked(monthlyReport).mockResolvedValueOnce(report());
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByLabelText('Income, USD 120.00')).toBeOnTheScreen();
  expect(monthlyReport).toHaveBeenNthCalledWith(2, year, month, undefined);
  expect(screen.queryByText('Could not load the report.')).not.toBeOnTheScreen();
});

test('a failed accounts read shows an error, and Retry reads again', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockRejectedValueOnce(new Error('Database unavailable'));
  jest.mocked(monthlyReport).mockResolvedValue(report());
  await renderScreen();

  expect(await screen.findByText('Could not load accounts.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: `Choose report year, ${year}` })).toBeEnabled();
  jest.mocked(listManagedAccounts).mockResolvedValueOnce([cash, bank]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByLabelText('Income, USD 120.00')).toBeOnTheScreen();
  expect(screen.queryByText('Could not load accounts.')).not.toBeOnTheScreen();
});

test('the year sheet keeps its draft through a failed read and a retry', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
  jest.mocked(monthlyReport).mockRejectedValueOnce(new Error('Database unavailable'));
  await renderScreen();
  await screen.findByText('Could not load the report.');

  await user.press(screen.getByRole('button', { name: `Choose report year, ${year}` }));
  await user.clear(screen.getByLabelText('Report year'));
  await user.type(screen.getByLabelText('Report year'), '20');
  jest.mocked(monthlyReport).mockResolvedValueOnce(report());
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByLabelText('Income, USD 120.00')).toBeOnTheScreen();
  expect(screen.getByLabelText('Report year')).toHaveDisplayValue('20');
});

test('a refresh shows the new report', async () => {
  jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
  jest.mocked(monthlyReport).mockResolvedValueOnce(report());
  await renderScreen();
  await screen.findByLabelText('Income, USD 120.00');

  const refresh = Promise.withResolvers<Report>();
  jest.mocked(monthlyReport).mockReturnValueOnce(refresh.promise);
  await act(async () => refreshQueries());
  await waitFor(() => expect(monthlyReport).toHaveBeenCalledTimes(2));

  expect(screen.getByLabelText('Income, USD 120.00')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Loading reports')).not.toBeOnTheScreen();
  await act(async () => refresh.resolve({ summaries: [], spending: [] }));

  expect(await screen.findByLabelText('Income, USD 0.00')).toBeOnTheScreen();
});

test('a failed refresh keeps the report and shows an alert with Retry', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
  jest.mocked(monthlyReport).mockResolvedValueOnce(report());
  await renderScreen();
  await screen.findByLabelText('Income, USD 120.00');

  jest.mocked(monthlyReport).mockRejectedValueOnce(new Error('Database unavailable'));
  await act(async () => refreshQueries());

  expect(await screen.findByText('Could not refresh the report.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Income, USD 120.00')).toBeOnTheScreen();
  jest.mocked(monthlyReport).mockResolvedValueOnce(report(22000, 1000));
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByLabelText('Income, USD 220.00')).toBeOnTheScreen();
  expect(screen.queryByText('Could not refresh the report.')).not.toBeOnTheScreen();
});

test('a removed account in a refresh resets the scope to All accounts', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
  jest.mocked(monthlyReport).mockResolvedValue(report());
  await renderScreen();
  await screen.findByLabelText('Income, EUR 9.00');
  await chooseCash(user);
  await waitFor(() => expect(monthlyReport).toHaveBeenLastCalledWith(year, month, 7));
  await screen.findByRole('button', { name: 'Choose account scope, Cash · USD' });

  jest.mocked(listManagedAccounts).mockResolvedValue([bank]);
  await act(async () => refreshQueries());

  expect(
    await screen.findByRole('button', { name: 'Choose account scope, All accounts' }),
  ).toBeOnTheScreen();
  await waitFor(() => expect(monthlyReport).toHaveBeenLastCalledWith(year, month, undefined));
  expect(await screen.findByText('EUR report')).toBeOnTheScreen();
  expect(screen.queryByText('USD report')).not.toBeOnTheScreen();
  expect(screen.queryByLabelText('Loading reports')).not.toBeOnTheScreen();
});

describe('a change of month', () => {
  test('keeps the previous report visible and muted until the new report arrives', async () => {
    const user = userEvent.setup();
    jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
    const reads = reportReads();
    await renderScreen();
    await waitFor(() => expect(reads).toHaveLength(1));
    await act(async () => reads[0].read.resolve(report()));
    expect(await screen.findByLabelText('Income, USD 120.00')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: `${otherMonth} ${year}` }));
    await waitFor(() => expect(reads).toHaveLength(2));

    expect(screen.queryByLabelText('Loading reports')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Income, USD 120.00')).not.toBeOnTheScreen();
    expect(
      screen.getByLabelText('Income, USD 120.00', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    await act(async () => reads[1].read.resolve(report(22000, 1000)));

    expect(await screen.findByLabelText('Income, USD 220.00')).toBeOnTheScreen();
    expect(
      screen.queryByLabelText('Income, USD 120.00', { includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
  });

  test('during a pending read shows only the report of the new month', async () => {
    const user = userEvent.setup();
    jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
    const reads = reportReads();
    await renderScreen();
    await waitFor(() => expect(reads).toHaveLength(1));

    await user.press(screen.getByRole('button', { name: `${otherMonth} ${year}` }));
    await waitFor(() => expect(reads).toHaveLength(2));
    await act(async () => reads[1].read.resolve(report(22000, 1000)));
    expect(await screen.findByLabelText('Income, USD 220.00')).toBeOnTheScreen();

    await act(async () => reads[0].read.resolve(report(99900, 0)));
    expect(screen.getByLabelText('Income, USD 220.00')).toBeOnTheScreen();
    expect(
      screen.queryByLabelText('Income, USD 999.00', { includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
    expect(screen.getByText(`${otherMonth} ${year}`)).toBeOnTheScreen();
  });

  test('a return to a failed month reads again', async () => {
    const user = userEvent.setup();
    const current = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long' });
    jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
    const reads = reportReads();
    await renderScreen();
    await waitFor(() => expect(reads).toHaveLength(1));
    await act(async () => reads[0].read.reject(new Error('Database unavailable')));
    expect(await screen.findByText('Could not load the report.')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: `${otherMonth} ${year}` }));
    await waitFor(() => expect(reads).toHaveLength(2));
    await act(async () => reads[1].read.resolve(report(22000, 1000)));
    expect(await screen.findByLabelText('Income, USD 220.00')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: `${current} ${year}` }));
    await waitFor(() => expect(reads).toHaveLength(3));
    expect(reads[2].args).toEqual([year, month, undefined]);
    await act(async () => reads[2].read.resolve(report()));
    expect(await screen.findByLabelText('Income, USD 120.00')).toBeOnTheScreen();
  });
});
