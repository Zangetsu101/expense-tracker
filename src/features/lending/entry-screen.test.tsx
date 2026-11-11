import { createContext, useState, type ReactNode } from 'react';
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert, Pressable } from 'react-native';
import { router } from 'expo-router';
import { listAccounts, type Account } from '@/lib/database';
import {
  createPerson,
  deleteLendingEntry,
  listLendingEntries,
  listPeople,
  saveLendingEntry,
  type LendingEntry,
  type Person,
} from '@/lib/lending';
import { refreshQueries, renderWithQueries } from '@/test/render-with-queries';
import EntryScreen from './entry-screen';

const MockParamsContext = createContext<{ id?: string; personId?: string }>({});
let mockTitle: string | undefined;
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () =>
    jest.requireActual<typeof import('react')>('react').use(MockParamsContext),
  Stack: {
    Screen: ({ options }: { options?: { title?: string } }) => {
      mockTitle = options?.title;
      return null;
    },
  },
}));
jest.mock('@/lib/database', () => {
  const actual = jest.requireActual<typeof import('@/lib/database')>('@/lib/database');
  return {
    epochDay: actual.epochDay,
    dateFromEpochDay: actual.dateFromEpochDay,
    listAccounts: jest.fn(),
  };
});
jest.mock('@/lib/lending', () => ({
  createPerson: jest.fn(),
  deleteLendingEntry: jest.fn(),
  listLendingEntries: jest.fn(),
  listPeople: jest.fn(),
  saveLendingEntry: jest.fn(),
}));
jest.mock('@/components/quick-add-date', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { QuickAddDate: ({ value }: { value: Date }) => <Text>{value.toDateString()}</Text> };
});
jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const Box = ({ children }: { children: ReactNode }) => <View>{children}</View>;
  return {
    Host: Box,
    Column: Box,
    ScrollView: Box,
    Text: ({ children }: { children: ReactNode }) => <Text>{children}</Text>,
    BottomSheet: ({ children, isPresented }: { children: ReactNode; isPresented: boolean }) =>
      isPresented ? <View>{children}</View> : null,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} />
    ),
  };
});

const people: Person[] = [
  { id: 1, name: 'Rafi' },
  { id: 2, name: 'Sam' },
];
const accounts: Account[] = [
  { id: 1, name: 'Cash', currencyCode: 'USD', isFavorite: 1 },
  { id: 2, name: 'Bank', currencyCode: 'BDT', isFavorite: 0 },
];
const entry: LendingEntry = {
  id: 11,
  personId: 2,
  personName: 'Sam',
  kind: 'BORROW',
  transactionId: 40,
  currencyCode: 'BDT',
  amountMinor: 2500,
  date: 20000,
  note: 'Rent help',
  accountId: 2,
  accountName: 'Bank',
};

/** Renders the screen with route params that test buttons can change. */
function Route({ initial }: { initial: { id?: string; personId?: string } }) {
  const [params, setParams] = useState(initial);
  return (
    <MockParamsContext value={params}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open entry 11"
        onPress={() => setParams({ id: '11' })}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open entry 12"
        onPress={() => setParams({ id: '12' })}
      />
      <EntryScreen />
    </MockParamsContext>
  );
}

let alert: jest.SpyInstance<ReturnType<typeof Alert.alert>, Parameters<typeof Alert.alert>>;
beforeEach(() => {
  for (const mock of [
    createPerson,
    deleteLendingEntry,
    listLendingEntries,
    listPeople,
    saveLendingEntry,
    listAccounts,
  ])
    jest.mocked(mock).mockReset();
  jest.mocked(router.back).mockReset();
  jest.mocked(listPeople).mockResolvedValue(people);
  jest.mocked(listAccounts).mockResolvedValue(accounts);
  jest.mocked(listLendingEntries).mockResolvedValue([entry]);
  mockTitle = undefined;
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  alert.mockRestore();
});

async function renderScreen(params: { id?: string; personId?: string } = {}) {
  const view = await renderWithQueries(<Route initial={params} />);
  return view;
}

async function chooseAlert(label: string) {
  const button = alert.mock.calls.at(-1)?.[2]?.find((item) => item.text === label);
  expect(button?.onPress).toBeDefined();
  await act(async () => button!.onPress!());
}

test('a new entry shows a skeleton, then a form with the person and the first account', async () => {
  const read = Promise.withResolvers<Person[]>();
  jest.mocked(listPeople).mockReturnValue(read.promise);
  await renderScreen({ personId: '1' });

  expect(screen.getByLabelText('Loading entry form')).toBeOnTheScreen();
  expect(mockTitle).toBe('Add lending entry');
  await act(async () => read.resolve(people));

  expect(screen.queryByLabelText('Loading entry form')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Action: Lend' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Borrower: Rafi' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Account: Cash · USD' })).toBeOnTheScreen();
  expect(listLendingEntries).not.toHaveBeenCalled();
});

test('an edit fills the form from the entry and offers only actions of the same group', async () => {
  const user = userEvent.setup();
  await renderScreen({ id: '11' });

  expect(await screen.findByRole('button', { name: 'Lender: Sam' })).toBeOnTheScreen();
  expect(mockTitle).toBe('Edit lending entry');
  expect(screen.getByRole('button', { name: 'Action: Borrow' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Account: Bank · BDT' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Amount')).toHaveDisplayValue('25.00');
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Rent help');
  expect(screen.getByRole('button', { name: 'Delete entry' })).toBeEnabled();

  await user.press(screen.getByRole('button', { name: 'Action: Borrow' }));
  expect(screen.getByRole('button', { name: 'Repay' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Write off what you owe' })).not.toBeOnTheScreen();
});

test('a failed load shows an error, and Retry shows the form', async () => {
  const user = userEvent.setup();
  jest.mocked(listAccounts).mockRejectedValueOnce(new Error('Read failed'));
  await renderScreen();

  expect(await screen.findByText('Could not load the entry form.')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByRole('button', { name: 'Account: Cash · USD' })).toBeOnTheScreen();
  expect(screen.queryByText('Could not load the entry form.')).not.toBeOnTheScreen();
});

test('an unknown entry shows the error', async () => {
  await renderScreen({ id: '99' });

  expect(await screen.findByText('Could not load the entry form.')).toBeOnTheScreen();
});

test('a data change updates the pickers, keeps the fields, and disables writes while it reads', async () => {
  const user = userEvent.setup();
  await renderScreen({ personId: '1' });
  await user.type(await screen.findByLabelText('Amount'), '12');
  await user.type(screen.getByLabelText('Note'), 'Taxi');

  const refresh = Promise.withResolvers<Account[]>();
  jest.mocked(listAccounts).mockReturnValue(refresh.promise);
  await act(async () => refreshQueries());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save entry' })).toBeDisabled());

  await act(async () =>
    refresh.resolve([...accounts, { id: 3, name: 'Card', currencyCode: 'USD', isFavorite: 0 }]),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save entry' })).toBeEnabled());
  expect(screen.getByLabelText('Amount')).toHaveDisplayValue('12');
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Taxi');
  expect(screen.getByRole('button', { name: 'Account: Cash · USD' })).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Account: Cash · USD' }));
  expect(screen.getByRole('button', { name: 'Card · USD' })).toBeOnTheScreen();
});

test('a failed refresh keeps the form without an alert', async () => {
  const user = userEvent.setup();
  await renderScreen({ personId: '1' });
  await user.type(await screen.findByLabelText('Amount'), '12');

  jest.mocked(listPeople).mockRejectedValue(new Error('Refresh failed'));
  await act(async () => refreshQueries());
  await waitFor(() => expect(listPeople).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save entry' })).toBeEnabled());

  expect(screen.getByLabelText('Amount')).toHaveDisplayValue('12');
  expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  expect(screen.queryByText('Could not load the entry form.')).not.toBeOnTheScreen();
});

test('Save new person adds the person to the choices and selects the person', async () => {
  const user = userEvent.setup();
  const tara = { id: 3, name: 'Tara' };
  const refresh = Promise.withResolvers<Person[]>();
  jest.mocked(createPerson).mockImplementation(async () => {
    jest.mocked(listPeople).mockReturnValue(refresh.promise);
    return tara;
  });
  await renderScreen();
  expect(await screen.findByRole('button', { name: 'Borrower: Choose person' })).toBeOnTheScreen();

  await user.type(screen.getByLabelText('New person name'), 'Tara');
  await user.press(screen.getByRole('button', { name: 'Save new person' }));

  expect(createPerson).toHaveBeenCalledWith('Tara');
  // The person shows before the refresh ends.
  expect(await screen.findByRole('button', { name: 'Borrower: Tara' })).toBeOnTheScreen();
  expect(screen.getByLabelText('New person name')).toHaveDisplayValue('');
  await act(async () => refresh.resolve([...people, tara]));
  await user.press(screen.getByRole('button', { name: 'Borrower: Tara' }));
  expect(screen.getByRole('button', { name: 'Tara' })).toBeOnTheScreen();
});

test('Save sends the draft, asks again for an overpayment, and closes the screen', async () => {
  const user = userEvent.setup();
  jest
    .mocked(saveLendingEntry)
    .mockResolvedValueOnce({
      status: 'confirmation_required',
      warnings: [
        {
          personId: 1,
          currencyCode: 'USD',
          direction: 'LENT',
          principalMinor: 0,
          repaidMinor: 0,
          writtenOffMinor: 0,
          outstandingMinor: 0,
          overpaidMinor: 300,
        },
      ],
    })
    .mockResolvedValueOnce({ status: 'saved', id: 5 });
  await renderScreen({ personId: '1' });
  await user.type(await screen.findByLabelText('Amount'), '12.50');
  await user.press(screen.getByRole('button', { name: 'Save entry' }));

  expect(saveLendingEntry).toHaveBeenLastCalledWith(
    expect.objectContaining({
      personId: 1,
      kind: 'LEND',
      amountMinor: 1250,
      accountId: 1,
      currencyCode: 'USD',
      confirmOverpayment: false,
    }),
  );
  await waitFor(() => expect(alert.mock.calls.at(-1)?.[0]).toBe('Overpayment warning'));
  expect(router.back).not.toHaveBeenCalled();
  // The first write changed no data, so the form does not read again.
  expect(listPeople).toHaveBeenCalledTimes(1);
  await chooseAlert('Confirm');

  expect(saveLendingEntry).toHaveBeenLastCalledWith(
    expect.objectContaining({ amountMinor: 1250, confirmOverpayment: true }),
  );
  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
});

test('a delete closes the screen and the failed refresh does not replace the form', async () => {
  const user = userEvent.setup();
  jest.mocked(deleteLendingEntry).mockImplementation(async () => {
    jest.mocked(listLendingEntries).mockResolvedValue([]);
    return { status: 'deleted' };
  });
  await renderScreen({ id: '11' });

  await user.press(await screen.findByRole('button', { name: 'Delete entry' }));
  expect(alert.mock.calls.at(-1)?.[0]).toBe('Delete entry?');
  await chooseAlert('Delete');

  expect(deleteLendingEntry).toHaveBeenCalledWith(11, {
    confirmDelete: true,
    confirmOverpayment: false,
  });
  expect(router.back).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(listLendingEntries).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save entry' })).toBeEnabled());
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Rent help');
  expect(screen.queryByText('Could not load the entry form.')).not.toBeOnTheScreen();
});

test('an entry change during a pending read shows the new entry, not a late old result', async () => {
  const user = userEvent.setup();
  const first = Promise.withResolvers<LendingEntry[]>();
  const second = Promise.withResolvers<LendingEntry[]>();
  jest
    .mocked(listLendingEntries)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await renderScreen({ id: '11' });
  expect(screen.getByLabelText('Loading entry form')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Open entry 12' }));
  expect(screen.getByLabelText('Loading entry form')).toBeOnTheScreen();
  await act(async () => second.resolve([entry, { ...entry, id: 12, note: 'Second entry' }]));
  expect(await screen.findByDisplayValue('Second entry')).toBeOnTheScreen();

  await act(async () => first.resolve([entry]));
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Second entry');
});

test('a return to an entry whose read failed reads again', async () => {
  const user = userEvent.setup();
  jest.mocked(listLendingEntries).mockRejectedValueOnce(new Error('Read failed'));
  await renderScreen({ id: '11' });
  expect(await screen.findByText('Could not load the entry form.')).toBeOnTheScreen();

  jest.mocked(listLendingEntries).mockResolvedValue([entry, { ...entry, id: 12, note: 'Second' }]);
  await user.press(screen.getByRole('button', { name: 'Open entry 12' }));
  expect(await screen.findByDisplayValue('Second')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Open entry 11' }));

  expect(await screen.findByDisplayValue('Rent help')).toBeOnTheScreen();
  expect(screen.queryByText('Could not load the entry form.')).not.toBeOnTheScreen();
});

function Reopen() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle screen"
        onPress={() => setOpen((value) => !value)}
      />
      {open && <Route initial={{ id: '11' }} />}
    </>
  );
}

test('a form that opens again starts from a new read, not from the old entry', async () => {
  const user = userEvent.setup();
  await renderWithQueries(<Reopen />);
  expect(await screen.findByLabelText('Note')).toHaveDisplayValue('Rent help');

  await user.press(screen.getByRole('button', { name: 'Toggle screen' }));
  jest.mocked(listLendingEntries).mockResolvedValue([{ ...entry, note: 'Rent for May' }]);
  // TanStack Query keeps the result of a suspense query for one second at least.
  await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
  await user.press(screen.getByRole('button', { name: 'Toggle screen' }));

  expect(await screen.findByLabelText('Note')).toHaveDisplayValue('Rent for May');
});
