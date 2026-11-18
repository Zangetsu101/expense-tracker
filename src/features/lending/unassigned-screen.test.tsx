import type { ReactNode } from 'react';
import { act, screen, userEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { notifyDataChanged } from '@/lib/data-changes';
import {
  assignLendingTransactions,
  listPeople,
  loadUnassignedLending,
  type UnassignedLendingTransaction,
} from '@/lib/lending';
import { renderWithQueries } from '@/test/render-with-queries';
import UnassignedScreen from './unassigned-screen';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/lib/lending', () => ({
  listPeople: jest.fn(),
  loadUnassignedLending: jest.fn(),
  assignLendingTransactions: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@expo/ui', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Box = ({ children }: { children: ReactNode }) => <View>{children}</View>;
  return { BottomSheet: Box, Host: Box, RNHostView: Box };
});

const person = { id: 1, name: 'Rafi' };
const first: UnassignedLendingTransaction = {
  transactionId: 9,
  kind: 'LEND',
  amountMinor: 800,
  date: 20000,
  accountId: 1,
  accountName: 'Cash',
  currencyCode: 'USD',
  categoryName: 'Loan',
  note: null,
};
const second: UnassignedLendingTransaction = {
  ...first,
  transactionId: 10,
  kind: 'REPAY',
  categoryName: 'Repayment',
};
const empty = { rows: [], totals: [] };

beforeEach(() => {
  jest.mocked(listPeople).mockReset().mockResolvedValue([person]);
  jest
    .mocked(loadUnassignedLending)
    .mockReset()
    .mockResolvedValue({ rows: [first, second], totals: [] });
  jest.mocked(assignLendingTransactions).mockReset();
});

test('No person shows a skeleton and can retry a failed load or refresh', async () => {
  const user = userEvent.setup();
  const read = Promise.withResolvers<Awaited<ReturnType<typeof loadUnassignedLending>>>();
  jest.mocked(loadUnassignedLending).mockReturnValueOnce(read.promise);
  await renderWithQueries(<UnassignedScreen />);
  expect(screen.getByLabelText('Loading entries')).toBeOnTheScreen();
  await act(async () => read.reject(new Error('Read failed')));
  expect(await screen.findByText('Could not load the entries')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Retry' }));
  const row = await screen.findByRole('checkbox', { name: /Lent/ });
  jest.mocked(loadUnassignedLending).mockRejectedValueOnce(new Error('Refresh failed'));
  await act(async () => notifyDataChanged());
  expect(await screen.findByText('Could not refresh the entries')).toBeOnTheScreen();
  expect(row).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.queryByText('Could not refresh the entries')).not.toBeOnTheScreen();
});

test('Select all and Clear change selection, then a single assignment writes both entries', async () => {
  const user = userEvent.setup();
  jest.mocked(assignLendingTransactions).mockImplementation(async () => {
    jest.mocked(loadUnassignedLending).mockResolvedValue(empty);
    notifyDataChanged();
    return { status: 'saved', ids: [12, 13], person };
  });
  await renderWithQueries(<UnassignedScreen />);
  await user.press(await screen.findByRole('button', { name: 'Select all' }));
  expect(screen.getByText('2 selected')).toBeOnTheScreen();
  expect(screen.getByRole('checkbox', { name: /Lent/ })).toBeChecked();
  await user.press(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByRole('checkbox', { name: /Lent/ })).not.toBeChecked();
  await user.press(screen.getByRole('button', { name: 'Select all' }));
  await user.press(screen.getByRole('button', { name: 'Assign…' }));
  expect(screen.getByText('Assign 2 entries to')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Rafi' }));
  expect(assignLendingTransactions).toHaveBeenCalledTimes(1);
  expect(assignLendingTransactions).toHaveBeenCalledWith([9, 10], 1, { confirmOverpayment: false });
  expect(await screen.findByText('No entries without a person')).toBeOnTheScreen();
  expect(screen.getByText('2 entries assigned to Rafi')).toBeOnTheScreen();
});

test('a new person can be added from the sheet and only overpaid credit requires confirmation', async () => {
  const user = userEvent.setup();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(listPeople).mockResolvedValue([]);
  jest
    .mocked(assignLendingTransactions)
    .mockResolvedValueOnce({
      status: 'confirmation_required',
      warnings: [
        {
          personId: 0,
          direction: 'BORROWED',
          currencyCode: 'USD',
          outstandingMinor: 0,
          principalMinor: 0,
          writtenOffMinor: 0,
          repaidMinor: 800,
          overpaidMinor: 800,
        },
      ],
    })
    .mockRejectedValueOnce(new Error('Write failed'));
  try {
    await renderWithQueries(<UnassignedScreen />);
    await user.press(await screen.findByRole('checkbox', { name: /Repaid/ }));
    await user.press(screen.getByRole('button', { name: 'Assign…' }));
    await user.type(screen.getByLabelText('Find or add a person'), 'Sam');
    await user.press(screen.getByRole('button', { name: 'Add Sam' }));
    expect(assignLendingTransactions).toHaveBeenCalledWith([10], 'Sam', {
      confirmOverpayment: false,
    });
    expect(alert.mock.calls[0][0]).toBe('Overpayment warning');
    const confirm = alert.mock.calls[0][2]?.find((button) => button.text === 'Assign anyway');
    expect(confirm?.onPress).toBeDefined();
    await act(async () => confirm!.onPress!());
    expect(assignLendingTransactions).toHaveBeenLastCalledWith([10], 'Sam', {
      confirmOverpayment: true,
    });
    expect(await screen.findByText('Error: Write failed')).toBeOnTheScreen();
  } finally {
    alert.mockRestore();
  }
});
