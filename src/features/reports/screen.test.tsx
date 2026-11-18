import { act, screen, userEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { AppSheetProps } from '@/components/app-sheet';
import { listManagedAccounts, type ManagedAccount } from '@/lib/accounts';
import { notifyDataChanged } from '@/lib/data-changes';
import { rangeReport, spendDays } from '@/lib/reports';
import { renderWithQueries } from '@/test/render-with-queries';
import { ReportsScreen } from './index';
import { netWorthData, reportSettings, saveFiscalStart } from './read-reports.ts';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/app-sheet', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { AppSheet: ({ children }: AppSheetProps) => <View>{children}</View> };
});
jest.mock('@expo/ui/community/datetime-picker', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({ onValueChange }: { onValueChange: (event: unknown, date: Date) => void }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pick 10 March 2026"
        onPress={() => onValueChange({}, new Date(2026, 2, 10, 12))}
      >
        <Text>Date picker</Text>
      </Pressable>
    ),
  };
});
jest.mock('@/lib/accounts', () => ({ listManagedAccounts: jest.fn() }));
jest.mock('@/lib/reports', () => {
  // spendHistory uses the real periods and reads its rows through the spendDays mock.
  const { periodsBack } =
    jest.requireActual<typeof import('@/lib/usual-spending')>('@/lib/usual-spending');
  const spendDays = jest.fn();
  return {
    rangeReport: jest.fn(),
    spendDays,
    spendHistory: async (
      accountId: number | null,
      kind: 'week' | 'month',
      monthStart: number,
      today: number,
      back: number,
    ) => {
      const periods = periodsBack(kind, today, monthStart, back);
      return { periods, rows: await spendDays(accountId, periods.at(-1)!.start, periods[0].end) };
    },
  };
});
jest.mock('./read-reports.ts', () => ({
  reportSettings: jest.fn(),
  saveFiscalStart: jest.fn(),
  netWorthData: jest.fn(),
}));

type Report = Awaited<ReturnType<typeof rangeReport>>;
type Spend = Awaited<ReturnType<typeof spendDays>>[number];

const cash: ManagedAccount = {
  id: 7,
  name: 'Cash',
  currencyCode: 'USD',
  openingBalanceMinor: 0,
  isFavorite: 1,
};
const bank: ManagedAccount = {
  id: 8,
  name: 'Bank',
  currencyCode: 'EUR',
  openingBalanceMinor: 0,
  isFavorite: 0,
};
const spending = (
  categoryId: number,
  categoryName: string,
  topId: number,
  topName: string,
  amountMinor: number,
  currencyCode = 'USD',
) => ({ categoryId, categoryName, topId, topName, amountMinor, currencyCode });
const report = (income = 12000, expense = 3500): Report => ({
  summaries: [
    { currencyCode: 'USD', incomeMinor: income, expenseMinor: expense },
    { currencyCode: 'EUR', incomeMinor: 900, expenseMinor: 200 },
  ],
  spending: [
    spending(11, 'Groceries', 1, 'Food', expense - 1000),
    spending(12, 'Coffee', 1, 'Food', 1000),
    spending(3, 'Books', 3, 'Books', 200, 'EUR'),
  ],
});
const day = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const spend = (date: number, amountMinor: number, categoryId = 11, categoryName = 'Groceries') =>
  ({
    currencyCode: 'USD',
    categoryId,
    categoryName,
    topId: 1,
    topName: 'Food',
    date,
    amountMinor,
  }) satisfies Spend;
/** Groceries of 10.00 on the 2nd of December, January and February, and 25.00 this month. */
const history = [
  spend(day(2025, 12, 2), 1000),
  spend(day(2026, 1, 2), 1000),
  spend(day(2026, 2, 2), 1000),
  spend(day(2026, 3, 2), 2500),
];

const year = 2026;
const march = { start: day(2026, 3, 1), end: day(2026, 4, 1) };
const february = { start: day(2026, 2, 1), end: day(2026, 3, 1) };

beforeAll(() => {
  // The screen starts in the month of the clock. Fix the clock and keep the real timers.
  jest.useFakeTimers({
    now: new Date(year, 2, 15),
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
  jest.mocked(listManagedAccounts).mockReset().mockResolvedValue([cash, bank]);
  jest.mocked(rangeReport).mockReset().mockResolvedValue(report());
  jest.mocked(reportSettings).mockReset().mockResolvedValue({ monthStart: 1, fiscalStart: 6 });
  jest.mocked(saveFiscalStart).mockReset().mockResolvedValue();
  jest.mocked(spendDays).mockReset().mockResolvedValue([]);
  jest
    .mocked(netWorthData)
    .mockReset()
    .mockImplementation(async (accountId, today) => ({
      accounts: [cash, bank].filter((a) => accountId === null || a.id === accountId),
      changes: [],
      lending: [],
      rate: null,
      mainCurrency: 'USD',
      today,
    }));
  jest.mocked(router.push).mockReset();
});

async function renderScreen() {
  return renderWithQueries(<ReportsScreen />);
}

/** Each report read gets a deferred result that the test resolves or rejects. */
function reportReads() {
  const reads: { args: Parameters<typeof rangeReport>; read: PromiseWithResolvers<Report> }[] = [];
  jest.mocked(rangeReport).mockImplementation((...args) => {
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

test('first load shows a skeleton and then the totals of this month in the main Currency', async () => {
  const accounts = Promise.withResolvers<ManagedAccount[]>();
  jest.mocked(listManagedAccounts).mockReturnValue(accounts.promise);
  await renderScreen();

  expect(screen.getByLabelText('Loading reports')).toBeOnTheScreen();
  await act(async () => accounts.resolve([cash, bank]));

  expect(await screen.findByLabelText('Income, $120.00')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Choose range, March 2026' })).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Show USD' })).toBeChecked();
  expect(screen.queryByLabelText('Loading reports')).not.toBeOnTheScreen();
  expect(rangeReport).toHaveBeenLastCalledWith(march.start, march.end, undefined);
});

test('the arrows move the range by one month, and the next arrow stops at this month', async () => {
  const user = userEvent.setup();
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');
  expect(screen.getByRole('button', { name: 'Next range' })).toBeDisabled();

  await user.press(screen.getByRole('button', { name: 'Previous range' }));
  expect(
    await screen.findByRole('button', { name: 'Choose range, February 2026' }),
  ).toBeOnTheScreen();
  await waitFor(() =>
    expect(rangeReport).toHaveBeenLastCalledWith(february.start, february.end, undefined),
  );
  expect(screen.getByRole('button', { name: 'Next range' })).toBeEnabled();

  await user.press(screen.getByRole('button', { name: 'Next range' }));
  expect(await screen.findByRole('button', { name: 'Choose range, March 2026' })).toBeOnTheScreen();
});

test('a shortcut in the range sheet fills the range and closes the sheet', async () => {
  const user = userEvent.setup();
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');

  await user.press(screen.getByRole('button', { name: 'Choose range, March 2026' }));
  expect(screen.getByRole('button', { name: 'This month' })).toBeSelected();
  await user.press(screen.getByRole('button', { name: 'Last fiscal year' }));

  expect(await screen.findByRole('button', { name: 'Choose range, FY 2024–25' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Last fiscal year' })).not.toBeOnTheScreen();
  await waitFor(() =>
    expect(rangeReport).toHaveBeenLastCalledWith(day(2024, 7, 1), day(2025, 7, 1), undefined),
  );
});

test('the From date and the To date set any range', async () => {
  const user = userEvent.setup();
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');

  await user.press(screen.getByRole('button', { name: 'Choose range, March 2026' }));
  await user.press(screen.getByRole('button', { name: 'To, 31 Mar 2026' }));
  await user.press(screen.getByRole('button', { name: 'Pick 10 March 2026' }));

  expect(screen.getByRole('button', { name: 'To, 10 Mar 2026' })).toBeOnTheScreen();
  await waitFor(() =>
    expect(rangeReport).toHaveBeenLastCalledWith(march.start, day(2026, 3, 11), undefined),
  );
  await user.press(screen.getByRole('button', { name: 'Done' }));
  expect(
    screen.getByRole('button', { name: 'Choose range, 1 Mar – 10 Mar 2026' }),
  ).toBeOnTheScreen();
});

test('the first month of the fiscal year changes in the sheet and is saved', async () => {
  const user = userEvent.setup();
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');

  await user.press(screen.getByRole('button', { name: 'Choose range, March 2026' }));
  expect(screen.getByText('July')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Earlier month' }));

  expect(screen.getByText('June')).toBeOnTheScreen();
  expect(saveFiscalStart).toHaveBeenCalledWith(5);
  await user.press(screen.getByRole('button', { name: 'This fiscal year' }));
  await waitFor(() =>
    expect(rangeReport).toHaveBeenLastCalledWith(day(2025, 6, 1), day(2026, 6, 1), undefined),
  );
});

test('the Currency switch shows one Currency, and one Account hides the switch', async () => {
  const user = userEvent.setup();
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');

  await user.press(screen.getByRole('radio', { name: 'Show EUR' }));
  expect(await screen.findByLabelText('Income, €9.00')).toBeOnTheScreen();
  expect(screen.getByRole('link', { name: /^Books, €2\.00/ })).toBeOnTheScreen();

  await chooseCash(user);
  await waitFor(() => expect(rangeReport).toHaveBeenLastCalledWith(march.start, march.end, 7));
  expect(await screen.findByLabelText('Income, $120.00')).toBeOnTheScreen();
  expect(screen.queryByRole('radio', { name: 'Show EUR' })).not.toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Choose account scope, Cash · USD' }),
  ).toBeOnTheScreen();
});

test('a parent Category opens to show its children, and a row opens its Transactions', async () => {
  const user = userEvent.setup();
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');

  const food = screen.getByRole('button', { name: 'Food, $35.00' });
  expect(food).not.toBeExpanded();
  await user.press(food);
  expect(food).toBeExpanded();

  await user.press(screen.getByRole('link', { name: 'Coffee, $10.00' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/transactions',
    params: { categoryId: '12', startDate: '2026-03-01', endDate: '2026-03-31', type: 'EXPENSE' },
  });
  await user.press(screen.getByText('All Food Transactions ›'));
  expect(router.push).toHaveBeenLastCalledWith(
    expect.objectContaining({ params: expect.objectContaining({ categoryId: '1' }) }),
  );
});

test('the Trend cards say when usual needs more history', async () => {
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');

  expect(
    await screen.findByRole('button', {
      name: /^Pace, \$0\.00 so far, Needs 3 full months · 3 more/,
    }),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /^Movers, Not enough history/ })).toBeOnTheScreen();
  expect(
    screen.getByRole('button', {
      name: /^Net worth, \$0\.00 · €0\.00, One total for each Currency/,
    }),
  ).toBeOnTheScreen();
});

test('without a Display Rate, the Net worth card shows the total of each Currency', async () => {
  jest.mocked(netWorthData).mockImplementation(async (accountId, today) => ({
    accounts: [
      { ...cash, openingBalanceMinor: 1200 },
      { ...bank, openingBalanceMinor: 900 },
    ],
    changes: [],
    lending: [],
    rate: null,
    mainCurrency: 'USD',
    today,
  }));
  await renderScreen();

  expect(
    await screen.findByRole('button', {
      name: 'Net worth, $12.00 · €9.00, One total for each Currency',
    }),
  ).toBeOnTheScreen();
  expect(screen.getAllByLabelText(/^Total at each month end in /)).toHaveLength(2);
});

test('with history, the cards compare with usual, the rows get markers, and a card opens its page', async () => {
  const user = userEvent.setup();
  jest.mocked(spendDays).mockResolvedValue(history);
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');

  const pace = await screen.findByRole('button', {
    name: /^Pace, \$15\.00 above usual, \$25\.00 by day 15/,
  });
  expect(screen.getByRole('button', { name: /^Movers, Food \+\$15\.00/ })).toBeOnTheScreen();
  expect(await screen.findByLabelText('above usual')).toBeOnTheScreen();

  await user.press(pace);
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/reports/pace',
    params: { currency: 'USD' },
  });
});

test('a parent Category gets the marker of its total, not of its own Expenses', async () => {
  const user = userEvent.setup();
  const own = { categoryId: 1, categoryName: 'Food' };
  // Food itself stays at 10.00 a month. Coffee, its child, goes from 0.00 to 10.00.
  jest
    .mocked(spendDays)
    .mockResolvedValue([
      ...[day(2025, 12, 2), day(2026, 1, 2), day(2026, 2, 2), day(2026, 3, 2)].map((date) =>
        spend(date, 1000, own.categoryId, own.categoryName),
      ),
      spend(day(2026, 3, 3), 1000, 12, 'Coffee'),
    ]);
  jest.mocked(rangeReport).mockResolvedValue({
    summaries: [{ currencyCode: 'USD', incomeMinor: 0, expenseMinor: 2000 }],
    spending: [spending(1, 'Food', 1, 'Food', 1000), spending(12, 'Coffee', 1, 'Food', 1000)],
  });
  await renderScreen();

  const food = await screen.findByRole('button', { name: 'Food, $20.00' });
  await waitFor(() => expect(within(food).getByLabelText('above usual')).toBeOnTheScreen());
  await user.press(food);
  const ownRow = screen.getByRole('link', { name: 'Food, $10.00' });
  expect(within(ownRow).queryByLabelText('above usual')).not.toBeOnTheScreen();
  expect(
    within(screen.getByRole('link', { name: 'Coffee, $10.00' })).getByLabelText('above usual'),
  ).toBeOnTheScreen();
});

test('the Trends follow the selected Account', async () => {
  const user = userEvent.setup();
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');
  await chooseCash(user);

  await waitFor(() =>
    expect(spendDays).toHaveBeenLastCalledWith(7, expect.any(Number), expect.any(Number)),
  );
  expect(netWorthData).toHaveBeenLastCalledWith(7, day(2026, 3, 15));
  expect(await screen.findByRole('button', { name: /^Balance, \$0\.00/ })).toBeOnTheScreen();
});

test('a new Account keeps the old Trend cards dimmed until the new numbers arrive', async () => {
  const user = userEvent.setup();
  await renderScreen();
  await screen.findByRole('button', { name: /^Net worth, / });
  const trend = Promise.withResolvers<Awaited<ReturnType<typeof spendDays>>>();
  jest.mocked(spendDays).mockReturnValueOnce(trend.promise);
  await chooseCash(user);
  await waitFor(() =>
    expect(spendDays).toHaveBeenLastCalledWith(7, expect.any(Number), expect.any(Number)),
  );

  expect(screen.queryByLabelText('Loading Pace')).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /^Net worth, / })).not.toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: /^Net worth, /, includeHiddenElements: true }),
  ).toBeOnTheScreen();
  await act(async () => trend.resolve([]));

  expect(await screen.findByRole('button', { name: /^Balance, / })).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: /^Net worth, /, includeHiddenElements: true }),
  ).not.toBeOnTheScreen();
});

test('a failed report read shows an error, and Retry reads again', async () => {
  const user = userEvent.setup();
  jest.mocked(rangeReport).mockRejectedValueOnce(new Error('Database unavailable'));
  await renderScreen();

  expect(await screen.findByText('Could not load the report.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Choose account scope, All accounts' })).toBeEnabled();
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByLabelText('Income, $120.00')).toBeOnTheScreen();
  expect(screen.queryByText('Could not load the report.')).not.toBeOnTheScreen();
});

test('a failed accounts read shows an error, and Retry reads again', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockRejectedValueOnce(new Error('Database unavailable'));
  await renderScreen();

  expect(await screen.findByText('Could not load accounts.')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByLabelText('Income, $120.00')).toBeOnTheScreen();
  expect(screen.queryByText('Could not load accounts.')).not.toBeOnTheScreen();
});

test('a failed Trend read shows an error in its card only', async () => {
  const user = userEvent.setup();
  jest.mocked(netWorthData).mockRejectedValueOnce(new Error('Database unavailable'));
  await renderScreen();

  expect(await screen.findByText('Could not load Net worth.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Income, $120.00')).toBeOnTheScreen();
  expect(await screen.findByRole('button', { name: /^Pace,/ })).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: /^Net worth,/ })).toBeOnTheScreen();
});

test('a data change shows the new report', async () => {
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');

  const refresh = Promise.withResolvers<Report>();
  jest.mocked(rangeReport).mockReturnValueOnce(refresh.promise);
  await act(async () => notifyDataChanged());
  await waitFor(() => expect(rangeReport).toHaveBeenCalledTimes(2));

  expect(screen.getByLabelText('Income, $120.00')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Loading reports')).not.toBeOnTheScreen();
  await act(async () => refresh.resolve({ summaries: [], spending: [] }));

  expect(await screen.findByLabelText('Income, $0.00')).toBeOnTheScreen();
  expect(screen.getByText('No reportable Expenses in this range.')).toBeOnTheScreen();
});

test('a failed refresh keeps the report and shows an alert with Retry', async () => {
  const user = userEvent.setup();
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');

  jest.mocked(rangeReport).mockRejectedValueOnce(new Error('Database unavailable'));
  await act(async () => notifyDataChanged());

  expect(await screen.findByText('Could not refresh the report.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Income, $120.00')).toBeOnTheScreen();
  jest.mocked(rangeReport).mockResolvedValueOnce(report(22000, 1000));
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByLabelText('Income, $220.00')).toBeOnTheScreen();
  expect(screen.queryByText('Could not refresh the report.')).not.toBeOnTheScreen();
});

test('a removed account in a refresh resets the scope to All accounts', async () => {
  const user = userEvent.setup();
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');
  await chooseCash(user);
  await waitFor(() => expect(rangeReport).toHaveBeenLastCalledWith(march.start, march.end, 7));

  jest.mocked(listManagedAccounts).mockResolvedValue([bank]);
  await act(async () => notifyDataChanged());

  expect(
    await screen.findByRole('button', { name: 'Choose account scope, All accounts' }),
  ).toBeOnTheScreen();
  await waitFor(() =>
    expect(rangeReport).toHaveBeenLastCalledWith(march.start, march.end, undefined),
  );
  expect(await screen.findByLabelText('Income, €9.00')).toBeOnTheScreen();
});

describe('a change of range', () => {
  test('keeps the previous totals visible and muted until the new totals arrive', async () => {
    const user = userEvent.setup();
    const reads = reportReads();
    await renderScreen();
    await waitFor(() => expect(reads).toHaveLength(1));
    await act(async () => reads[0].read.resolve(report()));
    expect(await screen.findByLabelText('Income, $120.00')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Previous range' }));
    await waitFor(() => expect(reads).toHaveLength(2));

    expect(screen.queryByLabelText('Loading reports')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Income, $120.00')).not.toBeOnTheScreen();
    expect(
      screen.getByLabelText('Income, $120.00', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    await act(async () => reads[1].read.resolve(report(22000, 1000)));

    expect(await screen.findByLabelText('Income, $220.00')).toBeOnTheScreen();
  });

  test('during a pending read shows only the totals of the new range', async () => {
    const user = userEvent.setup();
    const reads = reportReads();
    await renderScreen();
    await waitFor(() => expect(reads).toHaveLength(1));

    await user.press(screen.getByRole('button', { name: 'Previous range' }));
    await waitFor(() => expect(reads).toHaveLength(2));
    await act(async () => reads[1].read.resolve(report(22000, 1000)));
    expect(await screen.findByLabelText('Income, $220.00')).toBeOnTheScreen();

    await act(async () => reads[0].read.resolve(report(99900, 0)));
    expect(screen.getByLabelText('Income, $220.00')).toBeOnTheScreen();
    expect(
      screen.queryByLabelText('Income, $999.00', { includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
  });

  test('a return to a failed range reads again', async () => {
    const user = userEvent.setup();
    const reads = reportReads();
    await renderScreen();
    await waitFor(() => expect(reads).toHaveLength(1));
    await act(async () => reads[0].read.reject(new Error('Database unavailable')));
    expect(await screen.findByText('Could not load the report.')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Previous range' }));
    await waitFor(() => expect(reads).toHaveLength(2));
    await act(async () => reads[1].read.resolve(report(22000, 1000)));
    expect(await screen.findByLabelText('Income, $220.00')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Next range' }));
    await waitFor(() => expect(reads).toHaveLength(3));
    expect(reads[2].args).toEqual([march.start, march.end, undefined]);
    await act(async () => reads[2].read.resolve(report()));
    expect(await screen.findByLabelText('Income, $120.00')).toBeOnTheScreen();
  });
});

test('the Trend label says that the range does not change the cards', async () => {
  await renderScreen();
  await screen.findByLabelText('Income, $120.00');
  expect(screen.getByText('The range does not change these.')).toBeOnTheScreen();
  expect(screen.getAllByRole('radio', { name: /^Show / })).toHaveLength(2);
});
