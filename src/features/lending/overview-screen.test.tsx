import { act, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { notifyDataChanged } from '@/lib/data-changes';
import {
  createPerson,
  listPeople,
  listUnassignedLendingTransactions,
  type Person,
  type UnassignedLendingTransaction,
} from '@/lib/lending';
import { renderWithQueries } from '@/test/render-with-queries';
import LendingScreen from './overview-screen';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/lending', () => ({
  createPerson: jest.fn(),
  listPeople: jest.fn(),
  listUnassignedLendingTransactions: jest.fn(),
}));

const people: Person[] = [
  { id: 1, name: 'Rafi' },
  { id: 2, name: 'Sam' },
];
const unassigned = [{ transactionId: 9 }] as UnassignedLendingTransaction[];

beforeEach(() => {
  for (const mock of [createPerson, listPeople, listUnassignedLendingTransactions])
    jest.mocked(mock).mockReset();
  jest.mocked(router.push).mockReset();
});

async function renderScreen() {
  const view = await renderWithQueries(<LendingScreen />);
  return view;
}

test('first load shows a skeleton, then the people and the unassigned count', async () => {
  const read = Promise.withResolvers<Person[]>();
  jest.mocked(listPeople).mockReturnValue(read.promise);
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue(unassigned);
  await renderScreen();

  expect(screen.getByLabelText('Loading people')).toBeOnTheScreen();
  expect(screen.getByLabelText('New person name')).toBeOnTheScreen();
  await act(async () => read.resolve(people));

  expect(screen.queryByLabelText('Loading people')).not.toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Unassigned historical entries (1)' }),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Rafi' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Sam' })).toBeOnTheScreen();
});

test('a failed load keeps the name draft, and Retry shows the people', async () => {
  const user = userEvent.setup();
  jest.mocked(listPeople).mockRejectedValueOnce(new Error('Read failed'));
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue([]);
  await renderScreen();

  expect(await screen.findByText('Could not load people.')).toBeOnTheScreen();
  await user.type(screen.getByLabelText('New person name'), 'Nadia');
  jest.mocked(listPeople).mockResolvedValue(people);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByRole('button', { name: 'Rafi' })).toBeOnTheScreen();
  expect(screen.queryByText('Could not load people.')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('New person name')).toHaveDisplayValue('Nadia');
  expect(screen.getByRole('button', { name: 'Save person' })).toBeEnabled();
});

test('a failed refresh keeps the people and shows an alert with Retry', async () => {
  const user = userEvent.setup();
  jest.mocked(listPeople).mockResolvedValue(people);
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue(unassigned);
  await renderScreen();
  await screen.findByRole('button', { name: 'Rafi' });

  jest.mocked(listPeople).mockRejectedValue(new Error('Refresh failed'));
  await act(async () => notifyDataChanged());

  expect(await screen.findByText('Could not refresh people.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Rafi' })).toBeOnTheScreen();
  jest.mocked(listPeople).mockResolvedValue([]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText(/No saved people yet/)).toBeOnTheScreen();
  expect(screen.queryByText('Could not refresh people.')).not.toBeOnTheScreen();
});

test('a data change shows the new people and count', async () => {
  jest.mocked(listPeople).mockResolvedValue(people);
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue(unassigned);
  await renderScreen();
  await screen.findByRole('button', { name: 'Rafi' });

  jest.mocked(listPeople).mockResolvedValue([...people, { id: 3, name: 'Tara' }]);
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue([]);
  await act(async () => notifyDataChanged());

  expect(await screen.findByRole('button', { name: 'Tara' })).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Unassigned historical entries (0)' }),
  ).toBeOnTheScreen();
});

test('Save person opens the new person, and a failed save shows the error', async () => {
  const user = userEvent.setup();
  jest.mocked(listPeople).mockResolvedValue(people);
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue([]);
  await renderScreen();
  await screen.findByRole('button', { name: 'Rafi' });

  jest.mocked(createPerson).mockRejectedValueOnce(new Error('Name taken'));
  await user.type(screen.getByLabelText('New person name'), 'Rafi');
  await user.press(screen.getByRole('button', { name: 'Save person' }));
  expect(screen.getByText('Error: Name taken')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Rafi' })).toBeOnTheScreen();

  jest.mocked(createPerson).mockResolvedValue({ id: 5, name: 'Rafi' });
  await user.press(screen.getByRole('button', { name: 'Save person' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/lending/person', params: { id: 5 } });
  expect(screen.getByLabelText('New person name')).toHaveDisplayValue('');
});
