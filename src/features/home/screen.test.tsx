import { spendHistory } from '@/lib/reports';
import { periodsBack, usualPeriods, type PeriodKind } from '@/lib/usual-spending';
import { AppState } from 'react-native';
import { focusManager, notifyManager, type QueryClient } from '@tanstack/react-query';
import { notifyDataChanged } from '@/lib/data-changes';
import { act, fireEvent, screen, userEvent, within, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { QueryTimeContext } from '@/lib/query-time';
import { renderWithQueries } from '@/test/render-with-queries';
import { homeDeckData, homeListPage, homePace, homeTrend, savePeriodSetting } from './read-home';
import type { DeckAccount } from './deck';
import HomeScreen from './screen';
jest.mock('@/lib/reports', () => ({ spendHistory: jest.fn() }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: {
    Screen: ({
      options,
    }: {
      options: { headerTitle?: () => React.ReactNode; headerRight?: () => React.ReactNode };
    }) => (
      <>
        {options.headerTitle?.()}
        {options.headerRight?.()}
      </>
    ),
  },
  useIsFocused: () => true,
  useFocusEffect: () => {},
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
jest.mock('@/lib/drive-backup-adapter', () => ({
  driveBackups: { status: async () => ({ status: 'disconnected' }) },
}));
jest.mock('@/lib/backup-background-task', () => ({ subscribeBackupSchedule: () => () => {} }));
jest.mock('./read-home', () => ({
  homeDeckData: jest.fn(),
  homeListPage: jest.fn(),
  homePace: jest.fn(),
  homeTrend: jest.fn(),
  homeSearch: jest.fn(async () => []),
  savePeriodSetting: jest.fn(),
}));

jest.mock('./trend-chart.tsx', () => {
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    TrendChart: ({ onScrub }: React.ComponentProps<typeof import('./trend-chart').TrendChart>) => (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scrub first point"
          onPress={() => onScrub(0)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Release chart"
          onPress={() => onScrub(null)}
        />
      </>
    ),
  };
});
const account = (id: number, name: string): DeckAccount => ({
  id,
  name,
  isFavorite: id === 1 ? 1 : 0,
  currencyCode: 'BDT',
  balanceMinor: 100000,
  lastUsedDay: null,
});
const accounts = [account(1, 'Cash'), account(2, 'Bank'), account(3, 'Savings')];
const deck = { accounts, displayRate: null, period: { range: 'month', monthStart: 1 } as const };
const today = Date.UTC(2026, 10, 14) / 86400000;
function spending(kind: PeriodKind, amountMinor = 6000) {
  const periods = periodsBack(kind, today, 1, usualPeriods);
  return {
    periods,
    rows: [
      {
        currencyCode: 'BDT',
        categoryId: 1,
        categoryName: 'Food',
        topId: 1,
        topName: 'Food',
        date: today,
        amountMinor,
      },
    ],
  };
}
const pace = [{ currencyCode: 'BDT', spentMinor: 6000, sameMinor: 5000, previousMinor: 9000 }];
beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() => notifyManager.setScheduler((callback) => setTimeout(callback, 0)));
beforeEach(() => {
  jest.useFakeTimers();
  jest
    .mocked(spendHistory)
    .mockReset()
    .mockImplementation(async (_, kind) => spending(kind));
  jest.mocked(homeDeckData).mockResolvedValue(deck);
  jest.mocked(homePace).mockResolvedValue(pace);
  jest.mocked(homeTrend).mockResolvedValue([1000, 1200, 1100]);
  jest.mocked(homeListPage).mockResolvedValue({
    periods: [{ period: { start: 20000, end: 20001, label: 'November' }, rows: [] }],
    firstDay: null,
    next: null,
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
const open = (client?: QueryClient) =>
  renderWithQueries(
    <QueryTimeContext value={new Date(2026, 10, 14)}>
      <HomeScreen />
    </QueryTimeContext>,
    client,
  );
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const periodButton = (name: string | RegExp) =>
  within(screen.getByLabelText('All accounts')).getByRole('button', { name });
test('loading and failed Home reads block adding until Retry loads the saved deck', async () => {
  const user = userEvent.setup();
  const read = Promise.withResolvers<typeof deck>();
  jest.mocked(homeDeckData).mockReturnValueOnce(read.promise);
  await open();
  expect(button('Add transaction')).toBeDisabled();
  expect(screen.getByLabelText('Loading activity')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /choose account/ })).toBeNull();
  expect(homeListPage).not.toHaveBeenCalled();
  await act(async () => read.reject(Error('offline')));
  await screen.findByText('Couldn’t load Home');
  await user.press(button('Retry'));
  expect(await screen.findByRole('button', { name: 'All accounts, choose account' })).toBeEnabled();
  expect(homeListPage).toHaveBeenCalledWith(null, deck.period, expect.any(Number), 0);
  expect(screen.getByLabelText('Card 1 of 4')).toBeOnTheScreen();
});
test('failed card retains its balance and retries independently of the list', async () => {
  const user = userEvent.setup();
  jest.mocked(spendHistory).mockRejectedValueOnce(Error('unavailable'));
  await open();
  await screen.findByText('Couldn’t load this card');
  const all = within(screen.getByLabelText('All accounts'));
  expect(all.getByLabelText('৳3,000.00')).toBeOnTheScreen();
  const reads = jest.mocked(homeListPage).mock.calls.length;
  await user.press(all.getByRole('button', { name: 'Retry' }));
  expect(await all.findByText('Spent ৳60.00')).toBeOnTheScreen();
  expect(homeListPage).toHaveBeenCalledTimes(reads);
});
test('changing the period saves the range and keeps previous spending visible until replacement arrives', async () => {
  const user = userEvent.setup();
  const view = await open();
  await screen.findByText('Spent ৳60.00');
  const read = Promise.withResolvers<ReturnType<typeof spending>>();
  jest.mocked(spendHistory).mockReturnValueOnce(read.promise);
  await user.press(periodButton('Period, November'));
  await user.press(screen.getByRole('radio', { name: 'This week' }));
  expect(screen.queryByRole('radio', { name: 'This week' })).toBeNull();
  expect(
    within(screen.getByLabelText('All accounts')).getByRole('button', {
      name: /Period, Week of/,
      busy: true,
    }),
  ).toBeEnabled();
  expect(screen.getByText('Spent ৳60.00', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.queryByText('Spent ৳60.00')).toBeNull();
  await waitFor(() =>
    expect(savePeriodSetting).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'week' }),
      expect.anything(),
    ),
  );
  await act(async () => read.resolve(spending('week', 1000)));
  expect(await screen.findByText('Spent ৳10.00')).toBeOnTheScreen();
  expect(
    within(screen.getByLabelText('All accounts')).getByRole('button', {
      name: /Period, Week of/,
      busy: false,
    }),
  ).toBeOnTheScreen();
  await view.unmount();
  await open(view.client);
  expect(periodButton(/Period, Week of/)).toBeOnTheScreen();
});
test('changing period recovers a failed card including when returning to its original range', async () => {
  const user = userEvent.setup();
  jest.mocked(spendHistory).mockRejectedValueOnce(Error('offline'));
  await open();
  await screen.findByText('Couldn’t load this card');
  for (const name of ['This year', 'This month']) {
    await user.press(periodButton(/^Period,/));
    await user.press(screen.getByRole('radio', { name }));
    expect(await screen.findByText('Spent ৳60.00')).toBeOnTheScreen();
  }
});
test('cached accounts stay visible through a failed refresh and a pending retry', async () => {
  const user = userEvent.setup();
  await open();
  await screen.findByText('Spent ৳60.00');
  jest.mocked(homeDeckData).mockRejectedValueOnce(Error('offline'));
  await act(async () => notifyDataChanged());
  await screen.findByText('Couldn’t refresh accounts');
  const read = Promise.withResolvers<typeof deck>();
  jest.mocked(homeDeckData).mockReturnValueOnce(read.promise);
  await user.press(button('Retry refresh'));
  expect(screen.getByText('Couldn’t refresh accounts')).toBeOnTheScreen();
  expect(within(screen.getByLabelText('Cash')).getByLabelText('৳1,000.00')).toBeOnTheScreen();
  await act(async () => read.reject(Error('still offline')));
  jest.mocked(homeDeckData).mockResolvedValue({
    ...deck,
    accounts: [{ ...accounts[0], balanceMinor: 250000 }, ...accounts.slice(1)],
  });
  await user.press(button('Retry refresh'));
  await waitFor(() => expect(screen.queryByText('Couldn’t refresh accounts')).toBeNull());
  expect(within(screen.getByLabelText('Cash')).getByLabelText('৳2,500.00')).toBeOnTheScreen();
});
test('settings and quick add follow the selected account across focus and deck changes', async () => {
  const user = userEvent.setup();
  const initial = focusManager.isFocused();
  const listener = jest.spyOn(AppState, 'addEventListener');
  const view = await open();
  await screen.findByRole('button', { name: 'All accounts, choose account' });
  await user.press(button('Settings'));
  expect(router.push).toHaveBeenCalledWith('/settings');
  await user.press(button('Add transaction'));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/quick-add',
    params: { accountId: '1' },
  });
  await user.press(button('All accounts, choose account'));
  await user.press(button('Bank'));
  await user.press(button('Add transaction'));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/quick-add',
    params: { accountId: '2' },
  });
  const subscription = listener.mock.calls.find(([event]) => event === 'change');
  if (!subscription) throw Error('Missing AppState listener');
  for (const state of ['inactive', 'active', 'background', 'active'] as const) {
    await act(() => subscription[1](state));
    expect(button('Bank, choose account')).toBeOnTheScreen();
  }
  jest.mocked(homeDeckData).mockResolvedValue({
    ...deck,
    accounts: [...accounts.slice(0, 2), { ...accounts[2], lastUsedDay: 20000 }],
  });
  await act(async () => notifyDataChanged());
  expect(await screen.findByLabelText('Card 4 of 4')).toBeOnTheScreen();
  expect(button('Bank, choose account')).toBeOnTheScreen();
  jest.mocked(homeDeckData).mockResolvedValue({ ...deck, accounts: [accounts[0], accounts[2]] });
  await act(async () => notifyDataChanged());
  await screen.findByRole('button', { name: 'All accounts, choose account' });
  expect(screen.getByLabelText('Card 1 of 3')).toBeOnTheScreen();
  await act(() => subscription[1]('background'));
  expect(focusManager.isFocused()).toBe(false);
  await view.unmount();
  expect(focusManager.isFocused()).toBe(initial);
});
test('one account has a Pace card and an action to add an account', async () => {
  const user = userEvent.setup();
  jest.mocked(homeDeckData).mockResolvedValue({ ...deck, accounts: [accounts[0]] });
  await open();
  await screen.findByRole('button', { name: 'Cash, choose account' });
  expect(screen.queryByLabelText(/^Card \d of/)).toBeNull();
  expect(await screen.findByText('Spent ৳60.00')).toBeOnTheScreen();
  await user.press(screen.getByText('+ Add an account'));
  expect(router.push).toHaveBeenCalledWith('/accounts');
});

test('scrubbing the chart shows the selected balance and releasing restores the current balance', async () => {
  const user = userEvent.setup();
  await open();
  const cash = within(await screen.findByLabelText('Cash'));
  await user.press(await cash.findByRole('button', { name: 'Scrub first point' }));
  expect(cash.getByText('৳10.00')).toBeOnTheScreen();
  await user.press(cash.getByRole('button', { name: 'Release chart' }));
  expect(cash.getByLabelText('৳1,000.00')).toBeOnTheScreen();
});
test('refresh keeps the current row actionable and search scoped until the new page arrives', async () => {
  const page: Awaited<ReturnType<typeof homeListPage>> = {
    periods: [
      {
        period: { start: 20000, end: 20001, label: 'November' },
        rows: [
          {
            id: 1,
            date: 20000,
            type: 'EXPENSE',
            accountId: 1,
            amountMinor: 500,
            currencyCode: 'BDT',
            accountName: 'Cash',
            transferAccountId: null,
            transferAccountName: null,
            categoryName: 'Lunch',
            categoryEmoji: null,
            parentCategoryName: null,
            note: null,
            excludeFromReport: 0,
          },
        ],
      },
    ],
    firstDay: 20000,
    next: null,
  };
  jest.mocked(homeListPage).mockResolvedValue(page);
  await open();
  await screen.findByText('Lunch');
  expect(
    screen.getByRole('search', { name: /Search transactions from November/ }),
  ).toBeOnTheScreen();
  for (const name of [
    'More',
    'Transfer between accounts',
    'Manage categories',
    'Manage accounts',
    'Reports',
    'Review transfer candidates',
    'Import, export and backup',
  ])
    expect(screen.queryByText(name)).toBeNull();
  const request = Promise.withResolvers<typeof page>();
  jest.mocked(homeListPage).mockReturnValueOnce(request.promise);
  await act(async () => notifyDataChanged());
  expect(screen.getByRole('button', { name: /Lunch, Cash/ })).toBeEnabled();
  expect(screen.queryByLabelText('Loading')).toBeNull();
  await act(async () =>
    request.resolve({ ...page, periods: [{ ...page.periods[0], rows: [] }], firstDay: null }),
  );
  expect(await screen.findByText('No transactions yet')).toBeOnTheScreen();
});
test('settling a swipe changes which account Quick add uses', async () => {
  const user = userEvent.setup();
  jest
    .spyOn(jest.requireActual('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 400, height: 800, scale: 1, fontScale: 1 });
  await open();
  await screen.findByRole('button', { name: 'All accounts, choose account' });
  await fireEvent(screen.getByTestId('home-account-deck'), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: 696, y: 0 } },
  });
  expect(button('Bank, choose account')).toBeOnTheScreen();
  await user.press(button('Add transaction'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/quick-add', params: { accountId: '2' } });
});
test('Quick add without accounts opens an unscoped draft', async () => {
  const user = userEvent.setup();
  jest.mocked(homeDeckData).mockResolvedValue({ ...deck, accounts: [] });
  await open();
  await user.press(await screen.findByRole('button', { name: 'Add transaction', disabled: false }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/quick-add', params: {} });
});

test('retrying failed activity reloads the list without rereading the deck', async () => {
  const user = userEvent.setup();
  jest.mocked(homeListPage).mockRejectedValueOnce(Error('offline'));
  await open();
  await screen.findByText('Couldn’t load account activity');
  const reads = jest.mocked(homeDeckData).mock.calls.length;
  await user.press(button('Retry'));
  expect(await screen.findByText('No transactions yet')).toBeOnTheScreen();
  expect(homeDeckData).toHaveBeenCalledTimes(reads);
});

test('monthly spending compares against prior months and opens Pace in Reports', async () => {
  const user = userEvent.setup();
  await open();
  await screen.findByText('Needs 3 full months · 3 more ›');
  const data = spending('month');
  jest.mocked(spendHistory).mockResolvedValue({
    ...data,
    rows: [
      ...data.rows,
      ...data.periods
        .slice(1, 4)
        .map((period) => ({ ...data.rows[0], date: period.start, amountMinor: 2000 })),
    ],
  });
  await act(async () => notifyDataChanged());
  await user.press(
    await screen.findByRole('button', { name: /৳40.00 more than usual by this point/ }),
  );
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/reports/pace',
    params: { currency: 'BDT' },
  });
});
