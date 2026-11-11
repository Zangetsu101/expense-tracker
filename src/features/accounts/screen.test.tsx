import { useState } from 'react';
import { Pressable } from 'react-native';
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import type { AppSheetProps } from '@/components/app-sheet';
import {
  createAccount,
  listManagedAccounts,
  setFavoriteAccount,
  type ManagedAccount,
} from '@/lib/accounts';
import { epochDay } from '@/lib/database';
import { QueryTimeContext } from '@/lib/query-time';
import { accountBalances, type AccountBalance } from '@/lib/reports';
import { refreshQueries, renderWithQueries } from '@/test/render-with-queries';
import { AccountsScreen } from './index';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/app-sheet', () => {
  const { Pressable, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AppSheet: ({ children, onDismiss }: AppSheetProps) => (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss sheet"
          onPress={onDismiss}
        />
        {children}
      </View>
    ),
  };
});
jest.mock('@/lib/accounts', () => ({
  listManagedAccounts: jest.fn(),
  createAccount: jest.fn(),
  setFavoriteAccount: jest.fn(),
}));
jest.mock('@/lib/reports', () => ({ accountBalances: jest.fn() }));

const cash: ManagedAccount = {
  id: 1,
  name: 'Cash',
  currencyCode: 'USD',
  openingBalanceMinor: 0,
  isFavorite: 1,
};
const bank: ManagedAccount = {
  id: 2,
  name: 'Bank',
  currencyCode: 'USD',
  openingBalanceMinor: 0,
  isFavorite: 0,
};
const balance = (account: ManagedAccount, balanceMinor: number): AccountBalance => ({
  id: account.id,
  name: account.name,
  currencyCode: account.currencyCode,
  balanceMinor,
});

const day1 = new Date(2026, 10, 9, 12);
const day2 = new Date(2026, 10, 10, 12);

beforeEach(() => {
  for (const read of [listManagedAccounts, accountBalances, createAccount, setFavoriteAccount])
    jest.mocked(read).mockReset();
});

async function renderScreen(ui = <AccountsScreen />) {
  const view = await renderWithQueries(ui);
  return view;
}

/** Gives the screen a day that the test can change with the "Next day" button. */
function DayParent({ days }: { days: Date[] }) {
  const [index, setIndex] = useState(0);
  return (
    <QueryTimeContext value={days[index]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next day"
        onPress={() => setIndex((current) => (current + 1) % days.length)}
      />
      <AccountsScreen />
    </QueryTimeContext>
  );
}

test('first load shows a skeleton and then the accounts with balances', async () => {
  const accounts = Promise.withResolvers<ManagedAccount[]>();
  jest.mocked(listManagedAccounts).mockReturnValue(accounts.promise);
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500)]);
  await renderScreen();

  expect(screen.getByLabelText('Loading accounts')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Add account' })).toBeEnabled();
  await act(async () => accounts.resolve([cash]));

  expect(await screen.findByText('Accounts (1)')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Loading accounts')).not.toBeOnTheScreen();
  expect(screen.getByText('Balance overview')).toBeOnTheScreen();
  expect(screen.getByText('Cash · Favorite')).toBeOnTheScreen();
  expect(screen.getAllByText(/15\.00/)).toHaveLength(2);
});

test('no accounts shows the empty text', async () => {
  jest.mocked(listManagedAccounts).mockResolvedValue([]);
  jest.mocked(accountBalances).mockResolvedValue([]);
  await renderScreen();

  expect(await screen.findByText('No accounts yet.')).toBeOnTheScreen();
  expect(screen.getByText('Accounts (0)')).toBeOnTheScreen();
  expect(screen.queryByText('Balance overview')).not.toBeOnTheScreen();
});

test('a missing balance fails the read, and Retry reads again', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
  jest.mocked(accountBalances).mockResolvedValueOnce([balance(cash, 1500)]);
  await renderScreen();

  expect(await screen.findByText('Could not load accounts.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Add account' })).toBeEnabled();
  jest.mocked(accountBalances).mockResolvedValueOnce([balance(cash, 1500), balance(bank, 700)]);
  await user.press(screen.getByRole('button', { name: 'Retry accounts' }));

  expect(await screen.findByText('Accounts (2)')).toBeOnTheScreen();
  expect(screen.queryByText('Could not load accounts.')).not.toBeOnTheScreen();
});

test('the add account sheet stays open with its text through an error and a retry', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockRejectedValueOnce(new Error('Disk error'));
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500)]);
  await renderScreen();
  await screen.findByText('Could not load accounts.');

  await user.press(screen.getByRole('button', { name: 'Add account' }));
  await user.type(screen.getByLabelText('Account name'), 'Savings');
  jest.mocked(listManagedAccounts).mockResolvedValueOnce([cash]);
  await user.press(screen.getByRole('button', { name: 'Retry accounts' }));

  expect(await screen.findByText('Accounts (1)')).toBeOnTheScreen();
  expect(screen.getByLabelText('Account name')).toHaveDisplayValue('Savings');
});

test('a created account shows after the data change, without a second read in the screen', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValueOnce([cash]);
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500), balance(bank, 0)]);
  jest.mocked(createAccount).mockImplementation(async () => {
    jest.mocked(listManagedAccounts).mockResolvedValueOnce([cash, bank]);
  });
  await renderScreen();
  await screen.findByText('Accounts (1)');

  await user.press(screen.getByRole('button', { name: 'Add account' }));
  await user.type(screen.getByLabelText('Account name'), 'Bank');
  await user.type(screen.getByLabelText('Currency code'), 'USD');
  await user.press(screen.getByRole('button', { name: 'Create account' }));

  expect(await screen.findByText('Accounts (2)')).toBeOnTheScreen();
  expect(createAccount).toHaveBeenCalledWith({
    name: 'Bank',
    currencyCode: 'USD',
    openingBalance: '0',
  });
  expect(screen.queryByLabelText('Account name')).not.toBeOnTheScreen();
  expect(listManagedAccounts).toHaveBeenCalledTimes(2);
});

test('a failed create keeps the sheet open with the error', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValue([cash]);
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500)]);
  jest.mocked(createAccount).mockRejectedValue(new Error('Enter a three-letter currency code.'));
  await renderScreen();
  await screen.findByText('Accounts (1)');

  await user.press(screen.getByRole('button', { name: 'Add account' }));
  await user.type(screen.getByLabelText('Account name'), 'Bank');
  await user.press(screen.getByRole('button', { name: 'Create account' }));

  expect(await screen.findByText('Error: Enter a three-letter currency code.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Account name')).toHaveDisplayValue('Bank');
});

test('a favorite change shows after the data change, and stars stay disabled during the refresh', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValueOnce([cash, bank]);
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500), balance(bank, 700)]);
  const refresh = Promise.withResolvers<ManagedAccount[]>();
  jest.mocked(setFavoriteAccount).mockImplementation(async () => {
    jest.mocked(listManagedAccounts).mockReturnValueOnce(refresh.promise);
  });
  await renderScreen();

  await user.press(
    await screen.findByRole('button', { name: 'Bank, set as favorite for Quick add' }),
  );
  expect(setFavoriteAccount).toHaveBeenCalledWith(2);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Bank, set as favorite for Quick add' }),
    ).toBeDisabled(),
  );

  await act(async () =>
    refresh.resolve([
      { ...bank, isFavorite: 1 },
      { ...cash, isFavorite: 0 },
    ]),
  );
  expect(await screen.findByText('Bank · Favorite')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Cash, set as favorite for Quick add' })).toBeEnabled();
});

test('account groups show singular and plural counts', async () => {
  const card: ManagedAccount = { ...bank, id: 3, name: 'Card', currencyCode: 'EUR' };
  jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank, card]);
  jest
    .mocked(accountBalances)
    .mockResolvedValue([balance(cash, 0), balance(bank, 0), balance(card, 0)]);
  await renderScreen();

  expect(await screen.findByText('USD · 2 accounts')).toBeOnTheScreen();
  expect(screen.getByText('EUR · 1 account')).toBeOnTheScreen();
});

test('Cancel closes the sheet without a write, and a negative opening balance stays', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValue([cash]);
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500)]);
  await renderScreen();
  await screen.findByText('Accounts (1)');

  await user.press(screen.getByRole('button', { name: 'Add account' }));
  await user.clear(screen.getByLabelText('Opening balance'));
  await user.type(screen.getByLabelText('Opening balance'), '-20');
  expect(screen.getByLabelText('Opening balance')).toHaveDisplayValue('-20');
  await user.press(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByLabelText('Opening balance')).not.toBeOnTheScreen();
  expect(createAccount).not.toHaveBeenCalled();
});

test('a pending create blocks Cancel and dismissal, and a failed create allows a second try', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValue([cash]);
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500)]);
  const create = Promise.withResolvers<void>();
  jest.mocked(createAccount).mockReturnValueOnce(create.promise);
  await renderScreen();
  await screen.findByText('Accounts (1)');

  await user.press(screen.getByRole('button', { name: 'Add account' }));
  await user.type(screen.getByLabelText('Account name'), 'Draft');
  await user.press(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await user.press(screen.getByRole('button', { name: 'Dismiss sheet' }));
  expect(screen.getByLabelText('Account name')).toBeOnTheScreen();

  await act(async () => create.reject(new Error('Create failed')));
  expect(await screen.findByText('Error: Create failed')).toBeOnTheScreen();
  expect(screen.getByLabelText('Account name')).toHaveDisplayValue('Draft');
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();

  jest.mocked(createAccount).mockResolvedValueOnce();
  await user.press(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() => expect(screen.queryByLabelText('Account name')).not.toBeOnTheScreen());
  expect(createAccount).toHaveBeenCalledTimes(2);
});

test('a failed refresh after a committed create retries the read and not the create', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValueOnce([cash]);
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500), balance(bank, 0)]);
  jest.mocked(createAccount).mockImplementation(async () => {
    jest.mocked(listManagedAccounts).mockRejectedValueOnce(new Error('Refetch failed'));
  });
  await renderScreen();
  await screen.findByText('Accounts (1)');

  await user.press(screen.getByRole('button', { name: 'Add account' }));
  await user.type(screen.getByLabelText('Account name'), 'Bank');
  await user.press(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText('Could not refresh accounts.')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Account name')).not.toBeOnTheScreen();

  jest.mocked(listManagedAccounts).mockResolvedValueOnce([cash, bank]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('Accounts (2)')).toBeOnTheScreen();
  expect(createAccount).toHaveBeenCalledTimes(1);
});

test('a failed favorite change shows the error and keeps the accounts', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValue([cash, bank]);
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500), balance(bank, 700)]);
  jest.mocked(setFavoriteAccount).mockRejectedValue(new Error('Account not found.'));
  await renderScreen();

  await user.press(
    await screen.findByRole('button', { name: 'Bank, set as favorite for Quick add' }),
  );

  expect(await screen.findByText('Error: Account not found.')).toBeOnTheScreen();
  expect(screen.getByText('Cash · Favorite')).toBeOnTheScreen();
});

test('a failed refresh keeps the accounts and shows an alert with Retry', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedAccounts).mockResolvedValueOnce([cash]);
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500)]);
  await renderScreen();
  await screen.findByText('Accounts (1)');

  jest.mocked(listManagedAccounts).mockRejectedValueOnce(new Error('Disk error'));
  await act(async () => refreshQueries());

  expect(await screen.findByText('Could not refresh accounts.')).toBeOnTheScreen();
  expect(screen.getByText('Cash · Favorite')).toBeOnTheScreen();

  jest.mocked(listManagedAccounts).mockResolvedValueOnce([cash, bank]);
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500), balance(bank, 700)]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('Accounts (2)')).toBeOnTheScreen();
  expect(screen.queryByText('Could not refresh accounts.')).not.toBeOnTheScreen();
});

test('a refresh to no accounts replaces the accounts with the empty text', async () => {
  jest.mocked(listManagedAccounts).mockResolvedValueOnce([cash]);
  jest.mocked(accountBalances).mockResolvedValue([balance(cash, 1500)]);
  await renderScreen();
  await screen.findByText('Accounts (1)');

  const refresh = Promise.withResolvers<ManagedAccount[]>();
  jest.mocked(listManagedAccounts).mockReturnValueOnce(refresh.promise);
  await act(async () => refreshQueries());

  expect(screen.getByText('Cash · Favorite')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Loading accounts')).not.toBeOnTheScreen();
  await act(async () => refresh.resolve([]));

  expect(await screen.findByText('No accounts yet.')).toBeOnTheScreen();
  expect(screen.queryByText('Cash · Favorite')).not.toBeOnTheScreen();
});

describe('a change of day', () => {
  function balancesByDay() {
    const reads = new Map<number, PromiseWithResolvers<AccountBalance[]>[]>();
    jest.mocked(accountBalances).mockImplementation((today) => {
      const read = Promise.withResolvers<AccountBalance[]>();
      reads.set(today!, [...(reads.get(today!) ?? []), read]);
      return read.promise;
    });
    return (date: Date) => reads.get(epochDay(date))?.at(-1);
  }

  test('keeps the previous balances until the balances of the new day arrive', async () => {
    const user = userEvent.setup();
    jest.mocked(listManagedAccounts).mockResolvedValue([cash]);
    const read = balancesByDay();
    await renderScreen(<DayParent days={[day1, day2]} />);
    await act(async () => read(day1)!.resolve([balance(cash, 1500)]));
    expect(await screen.findByText('Cash · Favorite')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getAllByText(/15\.00/)).toHaveLength(2);
    expect(screen.queryByLabelText('Loading accounts')).not.toBeOnTheScreen();

    await act(async () => read(day2)!.resolve([balance(cash, 2500)]));
    await waitFor(() => expect(screen.getAllByText(/25\.00/)).toHaveLength(2));
  });

  test('during a pending read shows only the balances of the new day', async () => {
    const user = userEvent.setup();
    jest.mocked(listManagedAccounts).mockResolvedValue([cash]);
    const read = balancesByDay();
    await renderScreen(<DayParent days={[day1, day2]} />);
    await waitFor(() => expect(read(day1)).toBeDefined());

    await user.press(screen.getByRole('button', { name: 'Next day' }));
    await waitFor(() => expect(read(day2)).toBeDefined());
    await act(async () => read(day2)!.resolve([balance(cash, 2500)]));
    await waitFor(() => expect(screen.getAllByText(/25\.00/)).toHaveLength(2));

    await act(async () => read(day1)!.resolve([balance(cash, 1500)]));
    expect(screen.getAllByText(/25\.00/)).toHaveLength(2);
    expect(screen.queryByText(/15\.00/)).not.toBeOnTheScreen();
  });
});
