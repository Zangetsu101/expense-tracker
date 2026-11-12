import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AccessibilityInfo, SectionList, StyleSheet, View, Pressable, Text } from 'react-native';
import {
  QueryClientProvider,
  QueryErrorResetBoundary,
  notifyManager,
  type QueryClient,
} from '@tanstack/react-query';
import { notifyDataChanged } from '@/lib/data-changes';
import { createQueryClient } from '@/lib/query-client';
import type { DeckAccount } from './deck.ts';
import type { ListPeriod, ListRow, ListScope } from './list.ts';
import { homeListPage, homeSearch, type HomeListPage } from './read-home.ts';
import { HomeActivity } from './home-activity.tsx';
import { homeListQuery } from './queries.ts';
import type { PeriodSetting } from './period.ts';

let mockFocused = true;
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useIsFocused: () => mockFocused,
  useFocusEffect: () => {},
}));
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
jest.mock('./read-home.ts', () => ({ homeListPage: jest.fn(), homeSearch: jest.fn() }));

const now = new Date(2026, 10, 12);
const today = Math.floor(Date.UTC(2026, 10, 12) / 86400000);
const november: ListPeriod = { start: today - 11, end: today + 1, label: 'November' };
const october: ListPeriod = { start: today - 42, end: today - 11, label: 'October' };
const accounts: DeckAccount[] = [
  { id: 1, name: 'Cash', currencyCode: 'BDT', isFavorite: 1, balanceMinor: 0, lastUsedDay: null },
  { id: 2, name: 'Bank', currencyCode: 'BDT', isFavorite: 0, balanceMinor: 0, lastUsedDay: null },
];
const row = (id: number, patch: Partial<ListRow> = {}): ListRow => ({
  id,
  type: 'EXPENSE',
  amountMinor: 500,
  date: today,
  accountId: 1,
  transferAccountId: null,
  accountName: 'Cash',
  transferAccountName: null,
  currencyCode: 'BDT',
  categoryName: `Lunch ${id}`,
  parentCategoryName: null,
  categoryEmoji: null,
  note: null,
  excludeFromReport: 0,
  ...patch,
});
const page = (
  rows: ListRow[],
  { period = november, next = null }: { period?: ListPeriod; next?: number | null } = {},
): HomeListPage => ({
  periods: [{ period, rows }],
  firstDay: rows.length || next !== null ? today - 400 : null,
  next,
});

const onShowAccount = jest.fn();
const onAdd = jest.fn();
let client: QueryClient;
const allAccounts: ListScope = { face: 'pace', accountId: null };
const trend = (accountId: number): ListScope => ({ face: 'trend', accountId });
function ListContent({
  scope,
  header = <View />,
  onSelect = onShowAccount,
  setting = { range: 'month', monthStart: 1 },
}: {
  scope: ListScope;
  header?: React.ReactElement;
  onSelect?: (accountId: number) => void;
  setting?: PeriodSetting;
}) {
  return (
    <HomeActivity
      header={header}
      scope={scope}
      scopeName={accounts.find((account) => account.id === scope.accountId)?.name ?? 'All accounts'}
      setting={setting}
      now={now}
      accounts={accounts}
      onShowAccount={onSelect}
      onAdd={onAdd}
    />
  );
}
const list = (scope: ListScope, header = <View />) => (
  <QueryClientProvider client={client}>
    <QueryErrorResetBoundary>
      <ListContent scope={scope} header={header} />
    </QueryErrorResetBoundary>
  </QueryClientProvider>
);
function ControlledList({ initialScope }: { initialScope: ListScope }) {
  const [scope, setScope] = useState(initialScope);
  const [setting, setSetting] = useState<PeriodSetting>({ range: 'month', monthStart: 1 });
  const select = (accountId: number, reset: () => void) => {
    reset();
    onShowAccount(accountId);
    void client.prefetchInfiniteQuery(homeListQuery(trend(accountId), setting, now));
    setScope(trend(accountId));
  };
  return (
    <QueryClientProvider client={client}>
      <QueryErrorResetBoundary>
        {({ reset }) => (
          <ListContent
            scope={scope}
            setting={setting}
            onSelect={(accountId) => select(accountId, reset)}
            header={
              <View>
                {accounts.map((account) => (
                  <Pressable
                    key={account.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${account.name}`}
                    onPress={() => select(account.id, reset)}
                  >
                    <Text>{account.name}</Text>
                  </Pressable>
                ))}
                {(['month', 'week'] as const).map((range) => (
                  <Pressable
                    key={range}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${range}`}
                    onPress={() => {
                      reset();
                      const next = { ...setting, range };
                      void client.prefetchInfiniteQuery(homeListQuery(scope, next, now));
                      setSetting(next);
                    }}
                  >
                    <Text>{range}</Text>
                  </Pressable>
                ))}
              </View>
            }
          />
        )}
      </QueryErrorResetBoundary>
    </QueryClientProvider>
  );
}

/**
 * The list reports the cells in view after layout, which the test renderer does not do.
 * A cell index counts the header of each day too: cell 1 is the first row of the first day.
 */
async function reportInView(cells: [index: number, row: ListRow][]) {
  const tokens = cells.map(([index, inView]) => ({
    item: { kind: 'row', row: inView },
    key: String(inView.id),
    index,
    isViewable: true,
  }));
  await fireEvent(screen.getByText(`Lunch ${cells[0][1].id}`), 'viewableItemsChanged', {
    viewableItems: tokens,
    changed: tokens,
  });
}
/** How far right of its place the row is: 0 in place, the screen width while it is hidden. */
const shift = (name: string) =>
  StyleSheet.flatten(screen.getByRole('button', { name }).parent?.props.style)?.transform?.[0]
    ?.translateX;
const scrolled = () =>
  jest.mocked(SectionList.prototype.scrollToLocation).mock.calls.map(([to]) => to);

// Query updates then land inside the `act` of the step that caused them.
beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() => notifyManager.setScheduler((callback) => setTimeout(callback, 0)));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(homeListPage).mockReset();
  jest.mocked(homeSearch).mockReset();
  mockFocused = true;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  client = createQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, gcTime: Infinity },
  });
  jest.spyOn(SectionList.prototype, 'scrollToLocation').mockImplementation(() => {});
});
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
  client.clear();
  jest.restoreAllMocks();
});

test('the list ends with the next older period and adds it below a divider', async () => {
  let fail = true;
  jest.mocked(homeListPage).mockImplementation(async (_scope, _setting, _today, steps) => {
    if (steps === 0) return page([row(1)], { next: 1 });
    if (fail) throw Error('unavailable');
    return page([row(2, { date: today - 20 })], { period: october });
  });
  await render(list(allAccounts));
  const user = userEvent.setup();
  expect(await screen.findByText('Start of November.')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Show October' }));
  expect(await screen.findByText('Couldn’t load October')).toBeOnTheScreen();
  expect(screen.getByText('Lunch 1')).toBeOnTheScreen();
  fail = false;
  await user.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Lunch 2')).toBeOnTheScreen();
  expect(screen.getByText('October')).toBeOnTheScreen();
  expect(screen.getByText('Start of October. This is the first Transaction.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Show October' })).not.toBeOnTheScreen();
});

test('the button becomes a spinner while the older period loads', async () => {
  let resolve: (page: HomeListPage) => void = () => {};
  jest
    .mocked(homeListPage)
    .mockImplementation(async (_scope, _setting, _today, steps) =>
      steps === 0 ? page([row(1)], { next: 1 }) : new Promise((done) => (resolve = done)),
    );
  await render(list(allAccounts));
  const user = userEvent.setup();
  await user.press(await screen.findByRole('button', { name: 'Show October' }));
  expect(screen.queryByRole('button', { name: 'Show October' })).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Loading')).toBeOnTheScreen();
  await act(async () => resolve(page([row(2, { date: today - 20 })], { period: october })));
  expect(await screen.findByText('Lunch 2')).toBeOnTheScreen();
});

test('a return to an Account keeps its loaded periods', async () => {
  jest
    .mocked(homeListPage)
    .mockImplementation(async (scope, _setting, _today, steps) =>
      steps === 0
        ? page([row(scope === 2 ? 3 : 1)], { next: 1 })
        : page([row(2, { date: today - 20 })], { period: october }),
    );
  await render(<ControlledList initialScope={trend(1)} />);
  const user = userEvent.setup();
  await user.press(await screen.findByRole('button', { name: 'Show October' }));
  expect(await screen.findByText('Lunch 2')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Show Bank' }));
  expect(await screen.findByText('Lunch 3')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Show Cash' }));
  expect(await screen.findByText('Lunch 1')).toBeOnTheScreen();
  expect(screen.getByText('Lunch 2')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Show October' })).not.toBeOnTheScreen();
});

test('returning to a range keeps its loaded older periods', async () => {
  jest.mocked(homeListPage).mockImplementation(async (_account, setting, _today, steps) => {
    if (setting.range === 'week') return page([row(3)]);
    return steps === 0
      ? page([row(1)], { next: 1 })
      : page([row(2, { date: today - 20 })], { period: october });
  });
  await render(<ControlledList initialScope={trend(1)} />);
  const user = userEvent.setup();
  await user.press(await screen.findByRole('button', { name: 'Show October' }));
  await screen.findByText('Lunch 2');
  await user.press(screen.getByRole('button', { name: 'Show week' }));
  await screen.findByText('Lunch 3');
  expect(screen.queryByText('Lunch 2')).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Show month' }));
  expect(await screen.findByText('Lunch 2')).toBeOnTheScreen();
});

test('All accounts with no Transactions offers Quick add and hides search', async () => {
  jest.mocked(homeListPage).mockResolvedValue(page([]));
  const view = await render(list(allAccounts));
  expect(await screen.findByText('No transactions yet')).toBeOnTheScreen();
  expect(
    screen.getByText('Your spending and income show here, by day. Tap + to add the first one.'),
  ).toBeOnTheScreen();
  expect(screen.queryByRole('search')).not.toBeOnTheScreen();
  expect(screen.queryByText('No transactions in November yet.')).not.toBeOnTheScreen();
  await view.rerender(list(trend(2)));
  expect(await screen.findByText('No transactions in Bank yet')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Add a transaction' }));
  expect(onAdd).toHaveBeenCalledTimes(1);
});

test('search filters the range of the cards in place and can widen to all dates', async () => {
  jest
    .mocked(homeListPage)
    .mockImplementation(async (_scope, _setting, _today, steps) =>
      steps === 0
        ? page([row(1, { note: 'Lunch with Rahim' }), row(2)], { next: 1 })
        : page([row(4, { note: 'rahim in October', date: today - 20 })], { period: october }),
    );
  jest
    .mocked(homeSearch)
    .mockResolvedValue([
      row(1, { note: 'Lunch with Rahim' }),
      row(3, { note: 'rahim', date: today - 300 }),
    ]);
  const view = await render(list(allAccounts));
  const user = userEvent.setup();
  await user.press(await screen.findByRole('button', { name: 'Show October' }));
  await screen.findByText('Lunch 4');
  const field = screen.getByRole('search', { name: 'Search transactions from November' });
  await user.type(field, 'rahim');
  expect(await screen.findByText('1 result')).toBeOnTheScreen();
  expect(screen.queryByText('Lunch 2')).not.toBeOnTheScreen();
  expect(screen.queryByText('Lunch 4')).not.toBeOnTheScreen();
  expect(screen.getByText('Showing matches in November.')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'More filters' }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/transactions',
    params: { query: 'rahim' },
  });
  await user.press(screen.getByRole('button', { name: 'Search all dates' }));
  expect(await screen.findByText('2 results')).toBeOnTheScreen();
  expect(homeSearch).toHaveBeenCalledWith(null, 'rahim');
  expect(screen.queryByRole('button', { name: 'Search all dates' })).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Clear search' }));
  expect(await screen.findByText('Lunch 2')).toBeOnTheScreen();
  await user.type(screen.getByRole('search'), 'rahim');
  await view.rerender(list(trend(2)));
  expect(screen.getByRole('search')).toHaveDisplayValue('');
});

test('a new row on screen waits until the list shows it, then slides in', async () => {
  let rows = [row(1)];
  jest.mocked(homeListPage).mockImplementation(async () => page(rows));
  await render(list(allAccounts));
  await screen.findByText('Lunch 1');
  await reportInView([[1, row(1)]]);
  rows = [row(5), row(1)];
  await act(async () => notifyDataChanged({ id: 5, date: today, accountIds: [1] }));
  await act(async () => client.invalidateQueries());
  await screen.findByText('Lunch 5');
  expect(screen.queryByText(/^Saved to/)).not.toBeOnTheScreen();
  expect(shift('Lunch 5, Cash, −৳5.00')).toBeGreaterThan(0);
  expect(shift('Lunch 1, Cash, −৳5.00')).toBe(0);
  await reportInView([
    [1, row(5)],
    [2, row(1)],
  ]);
  expect(shift('Lunch 5, Cash, −৳5.00')).toBe(0);
});

test('a row in view waits for Home to have focus again', async () => {
  let rows = [row(1)];
  jest.mocked(homeListPage).mockImplementation(async () => page(rows));
  const view = await render(list(allAccounts));
  await screen.findByText('Lunch 1');
  await reportInView([[1, row(1)]]);
  mockFocused = false;
  rows = [row(5), row(1)];
  await act(async () => notifyDataChanged({ id: 5, date: today, accountIds: [1] }));
  await act(async () => client.invalidateQueries());
  await screen.findByText('Lunch 5');
  await reportInView([[1, row(5)]]);
  expect(shift('Lunch 5, Cash, −৳5.00')).toBeGreaterThan(0);
  mockFocused = true;
  await view.rerender(list(allAccounts));
  expect(shift('Lunch 5, Cash, −৳5.00')).toBe(0);
});

test('a row that never comes into view shows after a while', async () => {
  let rows = [row(1)];
  jest.mocked(homeListPage).mockImplementation(async () => page(rows));
  await render(list(allAccounts));
  await screen.findByText('Lunch 1');
  await reportInView([[1, row(1)]]);
  jest.useFakeTimers();
  rows = [row(5), row(1)];
  await act(async () => notifyDataChanged({ id: 5, date: today, accountIds: [1] }));
  await act(async () => client.invalidateQueries());
  expect(shift('Lunch 5, Cash, −৳5.00')).toBeGreaterThan(0);
  await act(async () => jest.advanceTimersByTime(4000));
  expect(shift('Lunch 5, Cash, −৳5.00')).toBe(0);
  jest.useRealTimers();
});

test('a row saved off screen gets a snackbar, and Show scrolls to it', async () => {
  let rows = [row(1)];
  jest.mocked(homeListPage).mockImplementation(async () => page(rows));
  await render(list(allAccounts));
  await screen.findByText('Lunch 1');
  rows = [row(1), row(6, { date: today - 3 })];
  await act(async () => notifyDataChanged({ id: 6, date: today - 3, accountIds: [1] }));
  await act(async () => client.invalidateQueries());
  expect(screen.getByText('Saved to 9 Nov')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Show' }));
  expect(scrolled()).toEqual([expect.objectContaining({ sectionIndex: 1, itemIndex: 0 })]);
  expect(screen.queryByText('Saved to 9 Nov')).not.toBeOnTheScreen();
});

test('a row saved to another Account offers to swipe to that Account', async () => {
  jest
    .mocked(homeListPage)
    .mockImplementation(async (scope) =>
      page([scope === 2 ? row(9, { accountId: 2, accountName: 'Bank' }) : row(1)]),
    );
  const view = await render(list(trend(1)));
  await screen.findByText('Lunch 1');
  await act(async () => notifyDataChanged({ id: 9, date: today, accountIds: [2] }));
  expect(screen.getByText('Saved to Bank')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Show' }));
  expect(onShowAccount).toHaveBeenCalledWith(2);
  await view.rerender(list(trend(2)));
  await screen.findByText('Lunch 9');
  expect(scrolled()).toEqual([expect.objectContaining({ sectionIndex: 0, itemIndex: 0 })]);
});

test('the only Account counts spending like All accounts but does not repeat its name', async () => {
  jest
    .mocked(homeListPage)
    .mockResolvedValue(
      page([row(1, { note: 'with Rahim' }), row(2, { excludeFromReport: 1, amountMinor: 900 })]),
    );
  const only: ListScope = { face: 'pace', accountId: 1 };
  await render(list(only));
  expect(await screen.findByText('Spent ৳5.00')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Lunch 1, with Rahim, −৳5.00' })).toBeOnTheScreen();
  expect(homeListPage).toHaveBeenCalledWith(1, expect.anything(), today, 0);
});

test('the only Account with no Transactions shows the first-run message', async () => {
  jest.mocked(homeListPage).mockResolvedValue(page([]));
  await render(list({ face: 'pace', accountId: 1 }));
  expect(await screen.findByText('No transactions yet')).toBeOnTheScreen();
});

test('the first row in an empty list shows without a snackbar', async () => {
  let rows: ListRow[] = [];
  jest.mocked(homeListPage).mockImplementation(async () => page(rows));
  await render(list(trend(2)));
  await screen.findByText('No transactions in Bank yet');
  rows = [row(5, { accountId: 2, accountName: 'Bank' })];
  await act(async () => notifyDataChanged({ id: 5, date: today, accountIds: [2] }));
  await act(async () => client.invalidateQueries());
  expect(await screen.findByText('Lunch 5')).toBeOnTheScreen();
  expect(screen.queryByText(/^Saved to/)).not.toBeOnTheScreen();
});

test('Show for an older date loads periods until the row is in the list', async () => {
  jest
    .mocked(homeListPage)
    .mockImplementation(async (_scope, _setting, _today, steps) =>
      steps === 0
        ? page([row(1)], { next: 1 })
        : page([row(7, { date: today - 20 })], { period: october }),
    );
  await render(list(allAccounts));
  await screen.findByText('Lunch 1');
  await act(async () => notifyDataChanged({ id: 7, date: today - 20, accountIds: [1] }));
  await userEvent.setup().press(screen.getByRole('button', { name: 'Show' }));
  expect(await screen.findByText('Lunch 7')).toBeOnTheScreen();
  expect(scrolled()).toEqual([expect.objectContaining({ sectionIndex: 2, itemIndex: 0 })]);
});

test('a scroll to a row that is not rendered yet scrolls near it and tries once more', async () => {
  let rows = [row(1)];
  jest.mocked(homeListPage).mockImplementation(async () => page(rows));
  await render(list(allAccounts));
  await screen.findByText('Lunch 1');
  rows = [row(1), row(6, { date: today - 3 })];
  await act(async () => notifyDataChanged({ id: 6, date: today - 3, accountIds: [1] }));
  await act(async () => client.invalidateQueries());
  jest.useFakeTimers();
  await userEvent
    .setup({ advanceTimers: jest.advanceTimersByTime })
    .press(screen.getByRole('button', { name: 'Show' }));
  await fireEvent(screen.getByText('Lunch 1'), 'scrollToIndexFailed', {
    index: 3,
    highestMeasuredFrameIndex: 1,
    averageItemLength: 68,
  });
  await act(async () => jest.advanceTimersByTime(100));
  const tries = [expect.objectContaining({ sectionIndex: 1, itemIndex: 0 })];
  expect(scrolled()).toEqual([...tries, ...tries]);
});

test('a failed refresh keeps rows and offers a local retry', async () => {
  jest.mocked(homeListPage).mockResolvedValue(page([row(1)]));
  await render(list(allAccounts));
  await screen.findByText('Lunch 1');
  jest.mocked(homeListPage).mockRejectedValueOnce(Error('disk unavailable'));
  await act(async () => client.invalidateQueries());
  expect(await screen.findByText('Couldn’t refresh account activity')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Lunch 1, Cash, −৳5.00' })).toBeOnTheScreen();
  jest.mocked(homeListPage).mockResolvedValue(page([row(2)]));
  await userEvent.setup().press(screen.getByRole('button', { name: 'Retry refresh' }));
  expect(await screen.findByText('Lunch 2')).toBeOnTheScreen();
  expect(screen.queryByText('Couldn’t refresh account activity')).not.toBeOnTheScreen();
});

test('the deck and search stay usable while the first period loads', async () => {
  let resolve: (value: HomeListPage) => void = () => {};
  jest.mocked(homeListPage).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const openDeck = jest.fn();
  await render(
    list(
      allAccounts,
      <Pressable accessibilityRole="button" onPress={openDeck}>
        <Text>Account deck</Text>
      </Pressable>,
    ),
  );
  expect(screen.getByLabelText('Loading activity')).toBeOnTheScreen();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Account deck' }));
  expect(openDeck).toHaveBeenCalledTimes(1);
  await user.type(
    screen.getByRole('search', { name: 'Search transactions from November' }),
    'rahim',
  );
  await act(async () => resolve(page([row(1, { note: 'with Rahim' }), row(2)])));
  expect(await screen.findByText('1 result')).toBeOnTheScreen();
  expect(screen.getByRole('search')).toHaveDisplayValue('rahim');
  expect(screen.queryByText('Lunch 2')).not.toBeOnTheScreen();
});

test('an account change hides old rows from actions until its period arrives', async () => {
  const user = userEvent.setup();
  let resolve: (value: HomeListPage) => void = () => {};
  jest.mocked(homeListPage).mockImplementation(async (account) =>
    account === 2
      ? new Promise((done) => {
          resolve = done;
        })
      : page([row(1)]),
  );
  await render(<ControlledList initialScope={trend(1)} />);
  await screen.findByText('Lunch 1');
  await user.press(screen.getByRole('button', { name: 'Show Bank' }));
  expect(screen.queryByLabelText('Loading activity')).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Lunch 1, −৳5.00' })).not.toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Lunch 1, −৳5.00', includeHiddenElements: true }),
  ).toBeDisabled();
  await act(async () => resolve(page([row(3, { accountId: 2, accountName: 'Bank' })])));
  expect(await screen.findByRole('button', { name: 'Lunch 3, −৳5.00' })).toBeEnabled();
  expect(screen.queryByText('Lunch 1')).not.toBeOnTheScreen();
});

test('initial failure retries locally and preserves the search text', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest
    .mocked(homeListPage)
    .mockRejectedValueOnce(Error('disk unavailable'))
    .mockResolvedValue(page([row(1)]));
  await render(<ControlledList initialScope={trend(1)} />);
  await screen.findByText('Couldn’t load account activity');
  const user = userEvent.setup();
  await user.type(screen.getByRole('search'), 'lunch');
  await user.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Lunch 1')).toBeOnTheScreen();
  expect(screen.getByRole('search')).toHaveDisplayValue('lunch');
});

test('returning to an Account whose first read failed tries it again', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  let failed = true;
  jest.mocked(homeListPage).mockImplementation(async (account) => {
    if (account === 1 && failed) throw Error('disk unavailable');
    return page([row(account === 2 ? 2 : 1)]);
  });
  await render(<ControlledList initialScope={trend(1)} />);
  await screen.findByText('Couldn’t load account activity');
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Show Bank' }));
  await screen.findByText('Lunch 2');
  failed = false;
  await user.press(screen.getByRole('button', { name: 'Show Cash' }));
  expect(await screen.findByText('Lunch 1')).toBeOnTheScreen();
});

test('Show retains its saved-row target through an Account load failure and retry', async () => {
  const user = userEvent.setup();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  let failed = true;
  jest.mocked(homeListPage).mockImplementation(async (account) => {
    if (account === 2 && failed) throw Error('disk unavailable');
    return page([account === 2 ? row(9, { accountId: 2, accountName: 'Bank' }) : row(1)]);
  });
  await render(<ControlledList initialScope={trend(1)} />);
  await screen.findByText('Lunch 1');
  await act(async () => notifyDataChanged({ id: 9, date: today, accountIds: [2] }));
  await user.press(screen.getByRole('button', { name: 'Show' }));
  await screen.findByText('Couldn’t load account activity');
  failed = false;
  await user.press(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Lunch 9');
  expect(scrolled()).toEqual([expect.objectContaining({ sectionIndex: 0, itemIndex: 0 })]);
  await reportInView([[1, row(9, { accountId: 2, accountName: 'Bank' })]]);
  expect(shift('Lunch 9, −৳5.00')).toBe(0);
});

test('a late period read cannot replace the Account selected afterward', async () => {
  const user = userEvent.setup();
  let resolve: (value: HomeListPage) => void = () => {};
  jest.mocked(homeListPage).mockImplementation(async (account) =>
    account === 2
      ? new Promise((done) => {
          resolve = done;
        })
      : page([row(1)]),
  );
  await render(<ControlledList initialScope={trend(1)} />);
  await screen.findByText('Lunch 1');
  await user.press(screen.getByRole('button', { name: 'Show Bank' }));
  await user.press(screen.getByRole('button', { name: 'Show Cash' }));
  expect(await screen.findByRole('button', { name: 'Lunch 1, −৳5.00' })).toBeEnabled();
  await act(async () => resolve(page([row(2, { accountId: 2, accountName: 'Bank' })])));
  expect(screen.getByRole('button', { name: 'Lunch 1, −৳5.00' })).toBeEnabled();
  expect(screen.queryByText('Lunch 2')).not.toBeOnTheScreen();
});

test.each(['pending', 'failed'] as const)(
  'a save while the list is %s still offers Show and navigates to its Account',
  async (status) => {
    const user = userEvent.setup();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.mocked(homeListPage).mockImplementation(async (account) => {
      if (account === 1) {
        if (status === 'failed') throw Error('disk unavailable');
        return new Promise(() => {});
      }
      return page([row(9, { accountId: 2, accountName: 'Bank' })]);
    });
    await render(<ControlledList initialScope={trend(1)} />);
    if (status === 'failed') await screen.findByText('Couldn’t load account activity');
    else expect(screen.getByLabelText('Loading activity')).toBeOnTheScreen();
    await act(async () => notifyDataChanged({ id: 9, date: today, accountIds: [2] }));
    expect(await screen.findByText('Saved to Bank')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Show' }));
    expect(await screen.findByText('Lunch 9')).toBeOnTheScreen();
    expect(scrolled()).toEqual([expect.objectContaining({ sectionIndex: 0, itemIndex: 0 })]);
  },
);
