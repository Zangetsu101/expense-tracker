import { act, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { notifyDataChanged } from '@/lib/data-changes';
import {
  listPeopleWithLendingTotals,
  loadUnassignedLending,
  type LendingTotal,
} from '@/lib/lending';
import { renderWithQueries } from '@/test/render-with-queries';
import LendingScreen from './overview-screen';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, Stack: { Screen: () => null } }));
jest.mock('@/lib/lending', () => ({
  listPeopleWithLendingTotals: jest.fn(),
  loadUnassignedLending: jest.fn(),
}));

const total: LendingTotal = {
  personId: 1,
  currencyCode: 'USD',
  direction: 'LENT',
  principalMinor: 3000,
  repaidMinor: 0,
  writtenOffMinor: 0,
  outstandingMinor: 3000,
  overpaidMinor: 0,
};
const person = { id: 1, name: 'Rafi', totals: [total], lastDate: undefined };

beforeEach(() => {
  jest.mocked(listPeopleWithLendingTotals).mockReset().mockResolvedValue([person]);
  jest.mocked(loadUnassignedLending).mockReset().mockResolvedValue({ rows: [], totals: [] });
});

test('the overview shows the skeleton until its totals and people can appear together', async () => {
  const read = Promise.withResolvers<Awaited<ReturnType<typeof listPeopleWithLendingTotals>>>();
  jest.mocked(listPeopleWithLendingTotals).mockReturnValue(read.promise);
  await renderWithQueries(<LendingScreen />);
  expect(screen.getByLabelText('Loading lending')).toBeOnTheScreen();
  await act(async () => read.resolve([person]));
  expect(screen.queryByLabelText('Loading lending')).not.toBeOnTheScreen();
  expect(screen.getByText('Owed to you')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Rafi, Owes you' })).toBeOnTheScreen();
});

test('open people sort by balance, followed by No person and settled people', async () => {
  const user = userEvent.setup();
  jest.mocked(listPeopleWithLendingTotals).mockResolvedValue([
    person,
    {
      id: 2,
      name: 'Sam',
      totals: [{ ...total, personId: 2, direction: 'BORROWED', outstandingMinor: 8000 }],
      lastDate: undefined,
    },
    { id: 3, name: 'Kai', totals: [], lastDate: undefined },
  ]);
  jest.mocked(loadUnassignedLending).mockResolvedValue({
    rows: [
      {
        transactionId: 4,
        kind: 'LEND',
        accountId: 1,
        accountName: 'Cash',
        amountMinor: 1200,
        currencyCode: 'USD',
        date: 20000,
        categoryName: 'Loan',
        note: null,
      },
    ],
    totals: [{ ...total, personId: 0, outstandingMinor: 1200 }],
  });
  await renderWithQueries(<LendingScreen />);
  await screen.findByText('People');
  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
    'Sam, You owe',
    'Rafi, Owes you',
    'No person, 1 entry',
    'Kai, Settled',
    'Add entry',
  ]);
  expect(screen.getByText('$42.00')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Rafi, Owes you' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/accounts/lending/person',
    params: { id: '1', name: 'Rafi' },
  });
});

test('Retry recovers a failed load and a failed refresh keeps the people visible', async () => {
  const user = userEvent.setup();
  jest.mocked(listPeopleWithLendingTotals).mockRejectedValueOnce(new Error('Read failed'));
  await renderWithQueries(<LendingScreen />);
  expect(await screen.findByText('Could not load lending')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Rafi');

  jest.mocked(listPeopleWithLendingTotals).mockRejectedValue(new Error('Refresh failed'));
  await act(async () => notifyDataChanged());
  expect(await screen.findByText('Could not refresh lending')).toBeOnTheScreen();
  expect(screen.getByText('Rafi')).toBeOnTheScreen();
  jest.mocked(listPeopleWithLendingTotals).mockResolvedValue([]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No lending or borrowing yet')).toBeOnTheScreen();
  expect(screen.queryByText('No person')).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Add entry' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/quick-add',
    params: { mode: 'PERSON' },
  });
});
