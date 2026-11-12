import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SectionList, View } from 'react-native';
import { QueryClientProvider, notifyManager, type QueryClient } from '@tanstack/react-query';
import { notifyDataChanged } from '@/lib/data-changes';
import { createQueryClient } from '@/lib/query-client';
import type { DeckAccount } from './deck.ts';
import type { ListPeriod, ListRow, ListScope } from './list.ts';
import { homeListPage, homeSearch, type HomeListPage } from './read-home.ts';
import { TransactionList } from './transaction-list.tsx';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
jest.mock('./read-home.ts', () => ({ homeListPage: jest.fn(), homeSearch: jest.fn() }));
jest.mock('./view.tsx', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    ActivitySkeleton: () => <Text>Loading activity</Text>,
    ActivityError: () => <Text>Couldn’t load account activity</Text>,
  };
});

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
const list = (scope: ListScope) => (
  <QueryClientProvider client={client}>
    <TransactionList
      header={<View />}
      scope={scope}
      scopeName={accounts.find((account) => account.id === scope.accountId)?.name ?? 'All accounts'}
      setting={{ range: 'month', monthStart: 1 }}
      now={now}
      accounts={accounts}
      onShowAccount={onShowAccount}
      onAdd={onAdd}
    />
  </QueryClientProvider>
);
const scrolled = () =>
  jest.mocked(SectionList.prototype.scrollToLocation).mock.calls.map(([to]) => to);

// Query updates then land inside the `act` of the step that caused them.
beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() => notifyManager.setScheduler((callback) => setTimeout(callback, 0)));
beforeEach(() => {
  jest.resetAllMocks();
  client = createQueryClient();
  jest.spyOn(SectionList.prototype, 'scrollToLocation').mockImplementation(() => {});
});
afterEach(() => {
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

test('a return to an Account shows one period again', async () => {
  jest
    .mocked(homeListPage)
    .mockImplementation(async (scope, _setting, _today, steps) =>
      steps === 0
        ? page([row(scope === 2 ? 3 : 1)], { next: 1 })
        : page([row(2, { date: today - 20 })], { period: october }),
    );
  const view = await render(list(trend(1)));
  const user = userEvent.setup();
  await user.press(await screen.findByRole('button', { name: 'Show October' }));
  expect(await screen.findByText('Lunch 2')).toBeOnTheScreen();
  await view.rerender(list(trend(2)));
  expect(await screen.findByText('Lunch 3')).toBeOnTheScreen();
  await view.rerender(list(trend(1)));
  expect(await screen.findByText('Lunch 1')).toBeOnTheScreen();
  expect(screen.queryByText('Lunch 2')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Show October' })).toBeOnTheScreen();
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

test('a new row on screen shows without a snackbar', async () => {
  let rows = [row(1)];
  jest.mocked(homeListPage).mockImplementation(async () => page(rows));
  await render(list(allAccounts));
  await screen.findByText('Lunch 1');
  // The list reports the cells in view after layout, which the test renderer does not do.
  // Cell 1 is the first row of the first day.
  const cell = { item: { kind: 'row', row: row(1) }, key: '1', index: 1, isViewable: true };
  await fireEvent(screen.getByText('Lunch 1'), 'viewableItemsChanged', {
    viewableItems: [cell],
    changed: [cell],
  });
  rows = [row(5), row(1)];
  await act(async () => notifyDataChanged({ id: 5, date: today, accountIds: [1] }));
  await act(async () => client.invalidateQueries());
  expect(await screen.findByText('Lunch 5')).toBeOnTheScreen();
  expect(screen.queryByText(/^Saved to/)).not.toBeOnTheScreen();
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
