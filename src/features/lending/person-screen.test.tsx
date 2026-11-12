import { createContext, useState } from 'react';
import { act, screen, userEvent } from '@testing-library/react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import {
  listLendingEntries,
  listLendingTotals,
  listPeople,
  type LendingEntry,
  type LendingTotal,
  type Person,
} from '@/lib/lending';
import { refreshQueries, renderWithQueries } from '@/test/render-with-queries';
import PersonScreen from './person-screen';

const MockParamsContext = createContext<{ id?: string }>({});
let mockTitle: string | undefined;
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () =>
    jest.requireActual<typeof import('react')>('react').use(MockParamsContext),
  Stack: {
    Screen: ({ options }: { options?: { title?: string } }) => {
      mockTitle = options?.title;
      return null;
    },
  },
}));
jest.mock('@/lib/lending', () => ({
  listPeople: jest.fn(),
  listLendingEntries: jest.fn(),
  listLendingTotals: jest.fn(),
}));

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
    <MockParamsContext value={{ id }}>
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

beforeEach(() => {
  for (const mock of [listPeople, listLendingEntries, listLendingTotals])
    jest.mocked(mock).mockReset();
  jest.mocked(router.push).mockReset();
  mockTitle = undefined;
  jest.mocked(listPeople).mockResolvedValue(people);
  jest
    .mocked(listLendingTotals)
    .mockImplementation(async (personId) => (personId === 1 ? [total] : []));
});

async function renderScreen(id = '1') {
  const view = await renderWithQueries(<Route initialId={id} />);
  return view;
}

test('first load shows a skeleton with the title Person, then the ledger', async () => {
  const read = Promise.withResolvers<LendingEntry[]>();
  jest.mocked(listLendingEntries).mockReturnValue(read.promise);
  await renderScreen();

  expect(screen.getByLabelText('Loading person')).toBeOnTheScreen();
  expect(mockTitle).toBe('Person');
  await act(async () => read.resolve([entry]));

  expect(screen.queryByLabelText('Loading person')).not.toBeOnTheScreen();
  expect(mockTitle).toBe('Rafi');
  expect(screen.getByText('They owe you · USD')).toBeOnTheScreen();
  expect(screen.getByText('25.00')).toBeOnTheScreen();
  expect(screen.getByText('Lunch money')).toBeOnTheScreen();
});

test('a failed load shows an error, and Retry shows the ledger', async () => {
  const user = userEvent.setup();
  jest.mocked(listLendingEntries).mockRejectedValueOnce(new Error('Read failed'));
  await renderScreen();

  expect(await screen.findByText('Could not load this person.')).toBeOnTheScreen();
  expect(mockTitle).toBe('Person');
  jest.mocked(listLendingEntries).mockResolvedValue([entry]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('Lunch money')).toBeOnTheScreen();
  expect(screen.queryByText('Could not load this person.')).not.toBeOnTheScreen();
});

test('an unknown person shows the error', async () => {
  jest.mocked(listLendingEntries).mockResolvedValue([]);
  await renderScreen('99');

  expect(await screen.findByText('Could not load this person.')).toBeOnTheScreen();
});

test('a failed refresh keeps the ledger and shows an alert with Retry', async () => {
  const user = userEvent.setup();
  jest.mocked(listLendingEntries).mockResolvedValue([entry]);
  await renderScreen();
  await screen.findByText('Lunch money');

  jest.mocked(listLendingEntries).mockRejectedValue(new Error('Refresh failed'));
  await act(async () => refreshQueries());

  expect(await screen.findByText('Could not refresh this person.')).toBeOnTheScreen();
  expect(screen.getByText('Lunch money')).toBeOnTheScreen();
  jest.mocked(listLendingEntries).mockResolvedValue([]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('No entries yet.')).toBeOnTheScreen();
  expect(screen.queryByText('Could not refresh this person.')).not.toBeOnTheScreen();
});

test('a refresh shows new entries', async () => {
  jest.mocked(listLendingEntries).mockResolvedValue([entry]);
  await renderScreen();
  await screen.findByText('Lunch money');

  jest.mocked(listLendingEntries).mockResolvedValue([{ ...entry, note: 'Taxi' }]);
  await act(async () => refreshQueries());

  expect(await screen.findByText('Taxi')).toBeOnTheScreen();
  expect(screen.queryByText('Lunch money')).not.toBeOnTheScreen();
});

test('Add entry and Edit entry open the entry form for this person', async () => {
  const user = userEvent.setup();
  jest.mocked(listLendingEntries).mockResolvedValue([entry]);
  await renderScreen();

  await user.press(await screen.findByRole('button', { name: 'Add entry' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/lending/entry',
    params: { personId: 1 },
  });
  await user.press(screen.getByRole('button', { name: 'Edit entry' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/lending/entry',
    params: { id: 11, personId: 1 },
  });
});

test('a person change during a pending read shows the new person, not a late old result', async () => {
  const user = userEvent.setup();
  const first = Promise.withResolvers<LendingEntry[]>();
  const second = Promise.withResolvers<LendingEntry[]>();
  jest
    .mocked(listLendingEntries)
    .mockImplementation((personId) => (personId === 1 ? first.promise : second.promise));
  await renderScreen();
  expect(screen.getByLabelText('Loading person')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Open person 2' }));
  expect(screen.getByLabelText('Loading person')).toBeOnTheScreen();
  await act(async () => second.resolve([{ ...entry, id: 12, personId: 2, note: 'Bus fare' }]));
  expect(await screen.findByText('Bus fare')).toBeOnTheScreen();
  expect(mockTitle).toBe('Sam');

  await act(async () => first.resolve([entry]));
  expect(screen.getByText('Bus fare')).toBeOnTheScreen();
  expect(screen.queryByText('Lunch money')).not.toBeOnTheScreen();
  expect(mockTitle).toBe('Sam');
});

test('a return to a person whose read failed reads again', async () => {
  const user = userEvent.setup();
  jest.mocked(listLendingEntries).mockRejectedValueOnce(new Error('Read failed'));
  await renderScreen();
  expect(await screen.findByText('Could not load this person.')).toBeOnTheScreen();

  jest.mocked(listLendingEntries).mockResolvedValue([]);
  await user.press(screen.getByRole('button', { name: 'Open person 2' }));
  expect(await screen.findByText('No entries yet.')).toBeOnTheScreen();

  jest.mocked(listLendingEntries).mockResolvedValue([entry]);
  await user.press(screen.getByRole('button', { name: 'Open person 1' }));

  expect(await screen.findByText('Lunch money')).toBeOnTheScreen();
  expect(screen.queryByText('Could not load this person.')).not.toBeOnTheScreen();
});
