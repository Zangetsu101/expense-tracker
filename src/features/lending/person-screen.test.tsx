import { createContext, useState, type ReactNode } from 'react';
import { act, screen, userEvent } from '@testing-library/react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { notifyDataChanged } from '@/lib/data-changes';
import {
  loadPersonLedger,
  renamePerson,
  saveLendingEntry,
  type LendingEntry,
  type LendingTotal,
  type Person,
} from '@/lib/lending';
import { renderWithQueries } from '@/test/render-with-queries';
import PersonScreen from './person-screen';

const MockParamsContext = createContext<{ id?: string; name?: string }>({});
let mockTitle: string | undefined;
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () =>
    jest.requireActual<typeof import('react')>('react').use(MockParamsContext),
  Stack: {
    Screen: ({ options }: { options?: { title?: string; headerRight?: () => ReactNode } }) => {
      mockTitle = options?.title;
      return options?.headerRight?.() ?? null;
    },
  },
}));
jest.mock('@/lib/lending', () => ({
  loadPersonLedger: jest.fn(),
  renamePerson: jest.fn(),
  saveLendingEntry: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@expo/ui', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Box = ({ children }: { children: ReactNode }) => <View>{children}</View>;
  return { BottomSheet: Box, RNHostView: Box };
});

const people: Person[] = [
  { id: 1, name: 'Rafi' },
  { id: 2, name: 'Sam' },
];
const entry: LendingEntry = {
  id: 11,
  personId: 1,
  personName: 'Rafi',
  kind: 'LEND',
  transactionId: 40,
  currencyCode: 'USD',
  amountMinor: 2500,
  date: 20000,
  note: 'Lunch money',
  accountId: 1,
  accountName: 'Cash',
};
const total: LendingTotal = {
  personId: 1,
  currencyCode: 'USD',
  direction: 'LENT',
  principalMinor: 2500,
  repaidMinor: 0,
  writtenOffMinor: 0,
  outstandingMinor: 2500,
  overpaidMinor: 0,
};

/** Renders the screen with a route param that a test button can change. */
function Route({ initialId }: { initialId: string }) {
  const [id, setId] = useState(initialId);
  return (
    <MockParamsContext
      value={{ id, name: people.find((person) => String(person.id) === id)?.name }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open person 2"
        onPress={() => setId('2')}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open person 1"
        onPress={() => setId('1')}
      />
      <PersonScreen />
    </MockParamsContext>
  );
}

function ledger(
  entries: LendingEntry[] = [entry],
  person = people[0],
  totals = entries.length ? [total] : [],
) {
  return { person, entries, totals };
}

beforeEach(() => {
  jest
    .mocked(loadPersonLedger)
    .mockReset()
    .mockImplementation(async (id) => {
      const person = people.find((item) => item.id === id);
      if (!person) throw new Error('Person not found.');
      return id === 1 ? ledger() : ledger([], person);
    });
  mockTitle = undefined;
});

async function renderScreen(id = '1') {
  const view = await renderWithQueries(<Route initialId={id} />);
  return view;
}

test('first load shows a skeleton with the route name, then the ledger', async () => {
  const read = Promise.withResolvers<ReturnType<typeof ledger>>();
  jest.mocked(loadPersonLedger).mockReturnValue(read.promise);
  await renderScreen();

  expect(screen.getByLabelText('Loading person')).toBeOnTheScreen();
  expect(mockTitle).toBe('Rafi');
  await act(async () => read.resolve(ledger()));

  expect(screen.queryByLabelText('Loading person')).not.toBeOnTheScreen();
  expect(mockTitle).toBe('Rafi');
  expect(screen.getByText('Owes you · USD')).toBeOnTheScreen();
  expect(screen.getByText('−$25.00')).toBeOnTheScreen();
  expect(screen.getByText(/Lunch money/)).toBeOnTheScreen();
});

test('a failed load shows an error, and Retry shows the ledger', async () => {
  const user = userEvent.setup();
  jest.mocked(loadPersonLedger).mockRejectedValueOnce(new Error('Read failed'));
  await renderScreen();

  expect(await screen.findByText('Could not load this person')).toBeOnTheScreen();
  expect(mockTitle).toBe('Rafi');
  jest.mocked(loadPersonLedger).mockResolvedValue(ledger());
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText(/Lunch money/)).toBeOnTheScreen();
  expect(screen.queryByText('Could not load this person')).not.toBeOnTheScreen();
});

test('an unknown person shows the error', async () => {
  await renderScreen('99');

  expect(await screen.findByText('Could not load this person')).toBeOnTheScreen();
});

test('a failed refresh keeps the ledger and shows an alert with Retry', async () => {
  const user = userEvent.setup();
  jest.mocked(loadPersonLedger).mockResolvedValue(ledger());
  await renderScreen();
  await screen.findByText(/Lunch money/);

  jest.mocked(loadPersonLedger).mockRejectedValue(new Error('Refresh failed'));
  await act(async () => notifyDataChanged());

  expect(await screen.findByText('Could not refresh this person')).toBeOnTheScreen();
  expect(screen.getByText(/Lunch money/)).toBeOnTheScreen();
  jest.mocked(loadPersonLedger).mockResolvedValue(ledger([]));
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('No entries yet')).toBeOnTheScreen();
  expect(screen.queryByText('Could not refresh this person')).not.toBeOnTheScreen();
});

test('a data change shows new entries', async () => {
  jest.mocked(loadPersonLedger).mockResolvedValue(ledger());
  await renderScreen();
  await screen.findByText(/Lunch money/);

  jest.mocked(loadPersonLedger).mockResolvedValue(ledger([{ ...entry, note: 'Taxi' }]));
  await act(async () => notifyDataChanged());

  expect(await screen.findByText(/Taxi/)).toBeOnTheScreen();
  expect(screen.queryByText(/Lunch money/)).not.toBeOnTheScreen();
});

test('Add entry opens Quick add and a history row opens Receipt', async () => {
  const user = userEvent.setup();
  await renderScreen();
  await user.press(await screen.findByRole('button', { name: 'Add entry' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/quick-add',
    params: { mode: 'PERSON', personId: 1 },
  });
  await user.press(screen.getByRole('button', { name: 'Lent, Cash · Lunch money' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/transaction/[id]',
    params: { id: 40 },
  });
});

test('a person change during a pending read shows the new person, not a late old result', async () => {
  const user = userEvent.setup();
  const first = Promise.withResolvers<ReturnType<typeof ledger>>();
  const second = Promise.withResolvers<ReturnType<typeof ledger>>();
  jest
    .mocked(loadPersonLedger)
    .mockImplementation((personId) => (personId === 1 ? first.promise : second.promise));
  await renderScreen();
  expect(screen.getByLabelText('Loading person')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Open person 2' }));
  expect(screen.getByLabelText('Loading person')).toBeOnTheScreen();
  await act(async () =>
    second.resolve(ledger([{ ...entry, id: 12, personId: 2, note: 'Bus fare' }], people[1])),
  );
  expect(await screen.findByText(/Bus fare/)).toBeOnTheScreen();
  expect(mockTitle).toBe('Sam');

  await act(async () => first.resolve(ledger()));
  expect(screen.getByText(/Bus fare/)).toBeOnTheScreen();
  expect(screen.queryByText(/Lunch money/)).not.toBeOnTheScreen();
  expect(mockTitle).toBe('Sam');
});

test('a return to a person whose read failed reads again', async () => {
  const user = userEvent.setup();
  jest.mocked(loadPersonLedger).mockRejectedValueOnce(new Error('Read failed'));
  await renderScreen();
  expect(await screen.findByText('Could not load this person')).toBeOnTheScreen();

  jest.mocked(loadPersonLedger).mockResolvedValue(ledger([], people[1]));
  await user.press(screen.getByRole('button', { name: 'Open person 2' }));
  expect(await screen.findByText('No entries yet')).toBeOnTheScreen();

  jest.mocked(loadPersonLedger).mockResolvedValue(ledger());
  await user.press(screen.getByRole('button', { name: 'Open person 1' }));

  expect(await screen.findByText(/Lunch money/)).toBeOnTheScreen();
  expect(screen.queryByText('Could not load this person')).not.toBeOnTheScreen();
});

test('a balance offers its direction actions and a write-off starts at the open amount', async () => {
  const user = userEvent.setup();
  jest.mocked(saveLendingEntry).mockResolvedValue({ status: 'saved', id: 20 });
  await renderScreen();
  await user.press(await screen.findByRole('button', { name: /Owes you · USD/ }));
  expect(screen.getByRole('button', { name: 'Receive repayment' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Lend more' })).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Write off what they owe' }));
  expect(screen.getByLabelText('Amount')).toHaveDisplayValue('25.00');
  await user.clear(screen.getByLabelText('Amount'));
  await user.type(screen.getByLabelText('Amount'), '12');
  await user.press(screen.getByRole('button', { name: 'Write off $12.00' }));
  expect(saveLendingEntry).toHaveBeenCalledWith(
    expect.objectContaining({
      personId: 1,
      kind: 'WRITE_OFF_LENT',
      currencyCode: 'USD',
      amountMinor: 1200,
    }),
  );
});

test('the person menu renames the existing person', async () => {
  const user = userEvent.setup();
  jest.mocked(renamePerson).mockResolvedValue({ id: 1, name: 'Nadia' });
  await renderScreen();
  await user.press(await screen.findByRole('button', { name: 'Person options' }));
  await user.press(screen.getByRole('button', { name: 'Rename' }));
  await user.clear(screen.getByLabelText('Person name'));
  await user.type(screen.getByLabelText('Person name'), 'Nadia');
  await user.press(screen.getByRole('button', { name: 'Save name' }));
  expect(renamePerson).toHaveBeenCalledWith(1, 'Nadia');
  expect(router.setParams).toHaveBeenCalledWith({ name: 'Nadia' });
});
