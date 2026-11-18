import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { listManagedAccounts, type ManagedAccount } from '@/lib/accounts';
import { spendDays } from '@/lib/reports';
import { renderWithQueries } from '@/test/render-with-queries';
import { MoversScreen, NetWorthScreen, PaceScreen } from './index';
import { netWorthData, reportSettings } from './read-reports.ts';

const mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
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

type Spend = Awaited<ReturnType<typeof spendDays>>[number];
const cash: ManagedAccount = {
  id: 7,
  name: 'Cash',
  currencyCode: 'USD',
  openingBalanceMinor: 1000,
  isFavorite: 1,
};
const card: ManagedAccount = {
  id: 9,
  name: 'Card',
  currencyCode: 'USD',
  openingBalanceMinor: 0,
  isFavorite: 0,
};
const day = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const spend = (date: number, amountMinor: number, category: Partial<Spend> = {}): Spend => ({
  currencyCode: 'USD',
  categoryId: 11,
  categoryName: 'Groceries',
  topId: 1,
  topName: 'Food',
  date,
  amountMinor,
  ...category,
});
const coffee = { categoryId: 12, categoryName: 'Coffee' };
/** 10.00 of Groceries and 2.00 of Coffee on the 2nd of each of 3 months, then more this month. */
const history = [
  ...[12, 1, 2].flatMap((m) => {
    const y = m === 12 ? 2025 : 2026;
    return [spend(day(y, m, 2), 1000), spend(day(y, m, 2), 200, coffee)];
  }),
  spend(day(2026, 3, 2), 2500),
  spend(day(2026, 3, 3), 100, coffee),
];

beforeAll(() => {
  jest.useFakeTimers({
    now: new Date(2026, 2, 15),
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
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  mockParams.currency = 'USD';
  jest.mocked(listManagedAccounts).mockReset().mockResolvedValue([cash, card]);
  jest.mocked(reportSettings).mockReset().mockResolvedValue({ monthStart: 1, fiscalStart: 6 });
  jest.mocked(spendDays).mockReset().mockResolvedValue(history);
  jest
    .mocked(netWorthData)
    .mockReset()
    .mockImplementation(async (accountId, today) => ({
      accounts: [cash, card].filter((a) => accountId === null || a.id === accountId),
      changes: [
        { accountId: 7, month: 2026 * 12 + 1, changeMinor: 500 },
        { accountId: 9, month: 2026 * 12 + 2, changeMinor: -300 },
      ],
      lending: [
        { personId: 1, kind: 'LEND', currencyCode: 'USD', amountMinor: 400, date: day(2026, 3, 1) },
      ],
      rate: null,
      mainCurrency: 'USD',
      today,
    }));
  jest.mocked(router.push).mockReset();
});

test('Pace shows the comparison and the projection, and says when the usual month is passed', async () => {
  await renderWithQueries(<PaceScreen />);

  expect(await screen.findByText('$14.00 above usual')).toBeOnTheScreen();
  expect(screen.getByText('$26.00 by day 15 · usually $12.00')).toBeOnTheScreen();
  expect(screen.getByText(`about ${'$53.73'}`)).toBeOnTheScreen();
  expect(screen.getByText('You already spent more than the usual month.')).toBeOnTheScreen();
  expect(
    screen.getByText(
      'Usual is the median of the last 6 months at the same day. It uses 3 months now.',
    ),
  ).toBeOnTheScreen();
  expect(spendDays).toHaveBeenCalledWith(null, day(2025, 8, 1), day(2026, 4, 1));
});

test('Pace shows the amount left for each day while spending is below the usual month', async () => {
  jest
    .mocked(spendDays)
    .mockResolvedValue([
      ...history.filter((row) => row.date < day(2026, 3, 1)),
      ...[12, 1, 2].map((m) => spend(day(m === 12 ? 2025 : 2026, m, 20), 3000)),
      spend(day(2026, 3, 2), 1000),
    ]);
  await renderWithQueries(<PaceScreen />);

  expect(await screen.findByText('$2.00 below usual')).toBeOnTheScreen();
  expect(screen.getByText('Left per day to end at usual')).toBeOnTheScreen();
  // Usual for a month is $42.00. $10.00 is spent, and 16 days are left.
  expect(screen.getByText('$2.00')).toBeOnTheScreen();
});

test('Pace for one Account reads that Account, and a short history says what is missing', async () => {
  mockParams.accountId = '7';
  jest.mocked(spendDays).mockResolvedValue([spend(day(2026, 3, 2), 700)]);
  await renderWithQueries(<PaceScreen />);

  expect(await screen.findByText('Not enough history')).toBeOnTheScreen();
  expect(screen.getByText('$7.00 so far')).toBeOnTheScreen();
  expect(screen.getByText(/Needs 3 full months · 3 more\./)).toBeOnTheScreen();
  expect(spendDays).toHaveBeenCalledWith(7, expect.any(Number), expect.any(Number));
});

test('Pace for a week compares the weeks that start on Saturday', async () => {
  mockParams.kind = 'week';
  jest.mocked(spendDays).mockResolvedValue([]);
  await renderWithQueries(<PaceScreen />);
  await screen.findByText('Not enough history');
  // Sunday 15 March 2026. Its week started on Saturday 14 March.
  expect(spendDays).toHaveBeenCalledWith(null, day(2026, 1, 24), day(2026, 3, 21));
});

test('Movers opens a parent, links a child to its Transactions, and compares the last month', async () => {
  const user = userEvent.setup();
  await renderWithQueries(<MoversScreen />);

  expect(await screen.findByText('$14.00 above usual')).toBeOnTheScreen();
  const food = screen.getByRole('button', { name: 'Food, $26.00' });
  await user.press(food);
  expect(food).toBeExpanded();
  await user.press(screen.getByRole('link', { name: 'Coffee, $1.00' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/transactions',
    params: { categoryId: '12', startDate: '2026-03-01', endDate: '2026-03-15', type: 'EXPENSE' },
  });

  await user.press(screen.getByRole('radio', { name: 'February 2026' }));
  expect(await screen.findByText('Not enough history')).toBeOnTheScreen();
});

test('Net worth shows the Accounts, the lending block and the history span', async () => {
  const user = userEvent.setup();
  await renderWithQueries(<NetWorthScreen />);

  expect(await screen.findByText('$12.00')).toBeOnTheScreen();
  expect(screen.getByText('People owe you')).toBeOnTheScreen();
  expect(screen.getByText('+$4.00')).toBeOnTheScreen();
  expect(screen.getByText('$16.00')).toBeOnTheScreen();
  expect(
    screen.getByText('Lending totals can be incomplete. Some old Transactions have no person.'),
  ).toBeOnTheScreen();
  expect(screen.getByText('+$2.00 since Mar 2025')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: '6M' }));
  expect(screen.getByRole('button', { name: '6M' })).toBeSelected();
  expect(screen.getByText('+$2.00 since Sep 2025')).toBeOnTheScreen();
});

test('the balance of one Account has no lending block', async () => {
  mockParams.accountId = '9';
  await renderWithQueries(<NetWorthScreen />);

  expect(await screen.findByText('Card · USD')).toBeOnTheScreen();
  expect(screen.queryByText('People owe you')).not.toBeOnTheScreen();
  expect(
    screen.getByText(
      'Lending does not show for one Account. A lending entry has no link to an Account.',
    ),
  ).toBeOnTheScreen();
  await waitFor(() => expect(netWorthData).toHaveBeenLastCalledWith(9, day(2026, 3, 15)));
});
