import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { listManagedCategories, type ManagedCategory } from '@/lib/categories';
import { notifyDataChanged } from '@/lib/data-changes';
import { listAccounts, type Account } from '@/lib/database';
import { searchTransactions, type SearchFilters, type SearchRow } from '@/lib/transaction-search';
import { renderWithQueries } from '@/test/render-with-queries';
import { TransactionSearchScreen } from './index';

const mockParams: { accountId?: string } = {};
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/lib/database', () => ({ listAccounts: jest.fn() }));
jest.mock('@/lib/categories', () => ({ listManagedCategories: jest.fn() }));
jest.mock('@/lib/transaction-search', () => ({
  ...jest.requireActual('@/lib/transaction-search'),
  searchTransactions: jest.fn(),
}));

const cash: Account = { id: 1, name: 'Cash', currencyCode: 'USD', isFavorite: 1 };
const bank: Account = { id: 2, name: 'Bank', currencyCode: 'USD', isFavorite: 0 };
const food: ManagedCategory = {
  id: 5,
  name: 'Food',
  type: 'EXPENSE',
  parentId: null,
  parentName: null,
  needsReview: 0,
};
const row = (id: number, note: string): SearchRow => ({
  id,
  type: 'EXPENSE',
  amountMinor: 1250,
  date: 20400,
  note,
  accountName: 'Cash',
  transferAccountName: null,
  categoryName: 'Food',
  categoryPath: 'Food',
  currencyCode: 'USD',
});
const rows = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => row(from + index, `Row ${from + index}`));
const receipt = (note: string) => `View receipt for expense transaction, ${note}`;

beforeEach(() => {
  delete mockParams.accountId;
  jest.mocked(listAccounts).mockReset().mockResolvedValue([cash, bank]);
  jest.mocked(listManagedCategories).mockReset().mockResolvedValue([food]);
  jest.mocked(searchTransactions).mockReset();
});

async function renderScreen() {
  const view = await renderWithQueries(<TransactionSearchScreen />);
  return view;
}

/** Each search gets a deferred result that the test resolves or rejects. */
function searches() {
  const reads: {
    filters: SearchFilters;
    offset: number | undefined;
    read: PromiseWithResolvers<SearchRow[]>;
  }[] = [];
  jest.mocked(searchTransactions).mockImplementation((filters, offset) => {
    const read = Promise.withResolvers<SearchRow[]>();
    reads.push({ filters, offset, read });
    return read.promise;
  });
  return reads;
}

test('first load shows a skeleton and then the results, and the search field stays usable', async () => {
  const user = userEvent.setup();
  const reads = searches();
  await renderScreen();

  expect(screen.getByLabelText('Loading results')).toBeOnTheScreen();
  await user.type(screen.getByLabelText('Search transactions'), 'Ro');
  await waitFor(() => expect(reads.at(-1)?.filters.query).toBe('Ro'));
  await act(async () => reads.at(-1)!.read.resolve([row(1, 'Row 1')]));

  expect(await screen.findByRole('button', { name: receipt('Row 1') })).toBeOnTheScreen();
  expect(screen.getByText('1 result · 1 USD')).toBeOnTheScreen();
  expect(screen.getByLabelText('Search transactions')).toHaveDisplayValue('Ro');
  expect(screen.queryByLabelText('Loading results')).not.toBeOnTheScreen();
  // Settle the reads of the old text. A read that never settles keeps Jest running.
  await act(async () => reads.forEach(({ read }) => read.resolve([])));
});

test('no results shows the empty text', async () => {
  jest.mocked(searchTransactions).mockResolvedValue([]);
  await renderScreen();

  expect(
    await screen.findByText('No transactions match. Try clearing a filter.'),
  ).toBeOnTheScreen();
  expect(screen.getByText('0 results')).toBeOnTheScreen();
});

test('a failed search shows an error, and Retry reads again with the search text kept', async () => {
  const user = userEvent.setup();
  jest.mocked(searchTransactions).mockRejectedValue(new Error('Disk error'));
  await renderScreen();
  expect(await screen.findByText('Could not load results.')).toBeOnTheScreen();

  await user.type(screen.getByLabelText('Search transactions'), 'Row');
  expect(await screen.findByText('Could not load results.')).toBeOnTheScreen();
  jest.mocked(searchTransactions).mockResolvedValue([row(1, 'Row 1')]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByRole('button', { name: receipt('Row 1') })).toBeOnTheScreen();
  expect(screen.getByLabelText('Search transactions')).toHaveDisplayValue('Row');
  expect(searchTransactions).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Row' }), 0);
});

test('a data change shows the new results', async () => {
  jest.mocked(searchTransactions).mockResolvedValueOnce([row(1, 'Row 1')]);
  await renderScreen();
  await screen.findByRole('button', { name: receipt('Row 1') });

  const refresh = Promise.withResolvers<SearchRow[]>();
  jest.mocked(searchTransactions).mockReturnValueOnce(refresh.promise);
  await act(async () => notifyDataChanged());
  await waitFor(() => expect(searchTransactions).toHaveBeenCalledTimes(2));

  expect(screen.getByRole('button', { name: receipt('Row 1') })).toBeOnTheScreen();
  expect(screen.queryByLabelText('Loading results')).not.toBeOnTheScreen();
  await act(async () => refresh.resolve([]));

  expect(
    await screen.findByText('No transactions match. Try clearing a filter.'),
  ).toBeOnTheScreen();
});

test('a failed refresh keeps the results and shows an alert with Retry', async () => {
  const user = userEvent.setup();
  jest.mocked(searchTransactions).mockResolvedValueOnce([row(1, 'Row 1')]);
  await renderScreen();
  await screen.findByRole('button', { name: receipt('Row 1') });

  jest.mocked(searchTransactions).mockRejectedValueOnce(new Error('Disk error'));
  await act(async () => notifyDataChanged());

  expect(await screen.findByText('Could not refresh results.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: receipt('Row 1') })).toBeOnTheScreen();
  jest.mocked(searchTransactions).mockResolvedValueOnce([row(2, 'Row 2')]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByRole('button', { name: receipt('Row 2') })).toBeOnTheScreen();
  expect(screen.queryByText('Could not refresh results.')).not.toBeOnTheScreen();
});

test('Load more reads the next page, and a failed page shows an alert with Retry', async () => {
  const user = userEvent.setup();
  jest.mocked(searchTransactions).mockResolvedValueOnce(rows(50));
  await renderScreen();
  expect(await screen.findByText('50+ results · 50 USD loaded')).toBeOnTheScreen();

  jest.mocked(searchTransactions).mockRejectedValueOnce(new Error('Disk error'));
  await user.press(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Could not load more results.')).toBeOnTheScreen();
  expect(searchTransactions).toHaveBeenLastCalledWith(expect.anything(), 50);
  expect(screen.getByText('50+ results · 50 USD loaded')).toBeOnTheScreen();

  jest.mocked(searchTransactions).mockResolvedValueOnce(rows(3, 51));
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('53 results · 53 USD')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeOnTheScreen();
  expect(screen.queryByText('Could not load more results.')).not.toBeOnTheScreen();
});

describe('a change of search text', () => {
  test('keeps the previous results visible and muted until the new results arrive', async () => {
    const user = userEvent.setup();
    const reads = searches();
    await renderScreen();
    await act(async () => reads[0].read.resolve([row(1, 'Row 1')]));
    expect(await screen.findByRole('button', { name: receipt('Row 1') })).toBeOnTheScreen();

    await user.type(screen.getByLabelText('Search transactions'), 'x');
    await waitFor(() => expect(reads).toHaveLength(2));

    expect(screen.queryByLabelText('Loading results')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: receipt('Row 1') })).not.toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: receipt('Row 1'), includeHiddenElements: true }),
    ).toBeOnTheScreen();
    await act(async () => reads[1].read.resolve([row(2, 'Row 2')]));

    expect(await screen.findByRole('button', { name: receipt('Row 2') })).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: receipt('Row 1'), includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
  });

  test('during a pending read shows only the results of the new text', async () => {
    const user = userEvent.setup();
    const reads = searches();
    await renderScreen();
    await waitFor(() => expect(reads).toHaveLength(1));

    await user.type(screen.getByLabelText('Search transactions'), 'x');
    await waitFor(() => expect(reads).toHaveLength(2));
    await act(async () => reads[1].read.resolve([row(2, 'Row 2')]));
    expect(await screen.findByRole('button', { name: receipt('Row 2') })).toBeOnTheScreen();

    await act(async () => reads[0].read.resolve([row(1, 'Row 1')]));
    expect(screen.getByRole('button', { name: receipt('Row 2') })).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: receipt('Row 1'), includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
  });

  test('a return to failed text reads again', async () => {
    const user = userEvent.setup();
    const reads = searches();
    await renderScreen();
    await act(async () => reads[0].read.reject(new Error('Disk error')));
    expect(await screen.findByText('Could not load results.')).toBeOnTheScreen();

    await user.type(screen.getByLabelText('Search transactions'), 'x');
    await waitFor(() => expect(reads).toHaveLength(2));
    await act(async () => reads[1].read.resolve([row(2, 'Row 2')]));
    expect(await screen.findByRole('button', { name: receipt('Row 2') })).toBeOnTheScreen();

    await user.clear(screen.getByLabelText('Search transactions'));
    await waitFor(() => expect(reads).toHaveLength(3));
    expect(reads[2].filters.query).toBe('');
    await act(async () => reads[2].read.resolve([row(1, 'Row 1')]));
    expect(await screen.findByRole('button', { name: receipt('Row 1') })).toBeOnTheScreen();
  });
});

describe('active filter chips', () => {
  test('show "Selected" until the names load, and a chip press clears its filter', async () => {
    const user = userEvent.setup();
    mockParams.accountId = '2';
    const accounts = Promise.withResolvers<Account[]>();
    jest.mocked(listAccounts).mockReturnValue(accounts.promise);
    jest.mocked(searchTransactions).mockResolvedValue([row(1, 'Row 1')]);
    await renderScreen();

    expect(screen.getByRole('button', { name: 'Account: Selected ×' })).toBeOnTheScreen();
    expect(searchTransactions).toHaveBeenCalledWith(expect.objectContaining({ accountId: 2 }), 0);
    await act(async () => accounts.resolve([cash, bank]));
    expect(await screen.findByRole('button', { name: 'Account: Bank ×' })).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Account: Bank ×' }));
    expect(screen.queryByRole('button', { name: /^Account:/ })).not.toBeOnTheScreen();
    await waitFor(() =>
      expect(searchTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: null }),
        0,
      ),
    );
  });

  test('show "Selected" when the names fail to load, and a chip press still clears its filter', async () => {
    const user = userEvent.setup();
    mockParams.accountId = '2';
    jest.mocked(listAccounts).mockRejectedValue(new Error('Disk error'));
    jest.mocked(searchTransactions).mockResolvedValue([row(1, 'Row 1')]);
    await renderScreen();
    await screen.findByRole('button', { name: receipt('Row 1') });

    expect(screen.getByRole('button', { name: 'Account: Selected ×' })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Account: Selected ×' }));
    expect(screen.queryByRole('button', { name: /^Account:/ })).not.toBeOnTheScreen();
  });
});

describe('the filter modal', () => {
  test('applies the chosen account and type', async () => {
    const user = userEvent.setup();
    jest.mocked(searchTransactions).mockResolvedValue([row(1, 'Row 1')]);
    await renderScreen();
    await screen.findByRole('button', { name: receipt('Row 1') });

    await user.press(screen.getByRole('button', { name: 'Edit filters' }));
    await user.press(await screen.findByRole('button', { name: 'Bank' }));
    await user.press(screen.getByRole('button', { name: 'expense' }));
    await user.press(screen.getByRole('button', { name: 'Show results' }));

    await waitFor(() =>
      expect(searchTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: 2, type: 'EXPENSE' }),
        0,
      ),
    );
    expect(screen.getByRole('button', { name: 'Account: Bank ×' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Type: expense ×' })).toBeOnTheScreen();
  });

  test('shows an error with Retry for the options, and the other filters stay usable', async () => {
    const user = userEvent.setup();
    jest.mocked(listManagedCategories).mockRejectedValue(new Error('Disk error'));
    jest.mocked(searchTransactions).mockResolvedValue([row(1, 'Row 1')]);
    await renderScreen();
    await screen.findByRole('button', { name: receipt('Row 1') });

    await user.press(screen.getByRole('button', { name: 'Edit filters' }));
    expect(await screen.findByText('Could not load categories and accounts.')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'income' }));
    expect(screen.getByRole('button', { name: 'income' })).toBeSelected();

    jest.mocked(listManagedCategories).mockResolvedValue([food]);
    await user.press(screen.getByRole('button', { name: 'Retry categories and accounts' }));
    expect(await screen.findByRole('button', { name: 'Food · expense' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'income' })).toBeSelected();
  });

  test('shows a skeleton for the options while they load', async () => {
    const user = userEvent.setup();
    const categories = Promise.withResolvers<ManagedCategory[]>();
    jest.mocked(listManagedCategories).mockReturnValue(categories.promise);
    jest.mocked(searchTransactions).mockResolvedValue([row(1, 'Row 1')]);
    await renderScreen();
    await screen.findByRole('button', { name: receipt('Row 1') });

    await user.press(screen.getByRole('button', { name: 'Edit filters' }));
    expect(screen.getByLabelText('Loading categories and accounts')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Show results' })).toBeEnabled();
    await act(async () => categories.resolve([food]));

    expect(await screen.findByRole('button', { name: 'Cash' })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Loading categories and accounts')).not.toBeOnTheScreen();
  });
});
