import type { ReactNode } from 'react';
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import {
  assignLendingTransaction,
  listPeople,
  listUnassignedLendingTransactions,
  type LendingResult,
  type Person,
  type UnassignedLendingTransaction,
} from '@/lib/lending';
import { refreshQueries, renderWithQueries } from '@/test/render-with-queries';
import UnassignedScreen from './unassigned-screen';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/lib/lending', () => ({
  assignLendingTransaction: jest.fn(),
  listPeople: jest.fn(),
  listUnassignedLendingTransactions: jest.fn(),
}));
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

const intro = /Assign only when you know the person/;
const people: Person[] = [{ id: 1, name: 'Rafi' }];
const row: UnassignedLendingTransaction = {
  transactionId: 30,
  kind: 'LEND',
  amountMinor: 4000,
  date: 20000,
  accountId: 1,
  accountName: 'Cash',
  currencyCode: 'USD',
  categoryName: 'Loan',
  note: 'Old loan',
};

let alert: jest.SpyInstance<ReturnType<typeof Alert.alert>, Parameters<typeof Alert.alert>>;
beforeEach(() => {
  for (const mock of [assignLendingTransaction, listPeople, listUnassignedLendingTransactions])
    jest.mocked(mock).mockReset();
  jest.mocked(listPeople).mockResolvedValue(people);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  alert.mockRestore();
});

async function renderScreen() {
  const view = await renderWithQueries(<UnassignedScreen />);
  return view;
}

async function chooseAlert(label: string) {
  const button = alert.mock.calls.at(-1)?.[2]?.find((item) => item.text === label);
  expect(button?.onPress).toBeDefined();
  await act(async () => button!.onPress!());
}

test('first load shows the intro and a skeleton, then the entries', async () => {
  const read = Promise.withResolvers<UnassignedLendingTransaction[]>();
  jest.mocked(listUnassignedLendingTransactions).mockReturnValue(read.promise);
  await renderScreen();

  expect(screen.getByText(intro)).toBeOnTheScreen();
  expect(screen.getByLabelText('Loading unassigned entries')).toBeOnTheScreen();
  await act(async () => read.resolve([row]));

  expect(screen.queryByLabelText('Loading unassigned entries')).not.toBeOnTheScreen();
  expect(screen.getByText('Lent · 40.00 USD')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Assign person' })).toBeEnabled();
});

test('a failed load keeps the intro, and Retry shows the entries', async () => {
  const user = userEvent.setup();
  jest.mocked(listUnassignedLendingTransactions).mockRejectedValueOnce(new Error('Read failed'));
  await renderScreen();

  expect(await screen.findByText('Could not load unassigned entries.')).toBeOnTheScreen();
  expect(screen.getByText(intro)).toBeOnTheScreen();
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue([row]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('Old loan')).toBeOnTheScreen();
  expect(screen.queryByText('Could not load unassigned entries.')).not.toBeOnTheScreen();
});

test('a failed refresh keeps the entries and shows an alert with Retry', async () => {
  const user = userEvent.setup();
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue([row]);
  await renderScreen();
  await screen.findByText('Old loan');

  jest.mocked(listUnassignedLendingTransactions).mockRejectedValue(new Error('Refresh failed'));
  await act(async () => refreshQueries());

  expect(await screen.findByText('Could not refresh unassigned entries.')).toBeOnTheScreen();
  expect(screen.getByText('Old loan')).toBeOnTheScreen();
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue([]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('No unassigned historical lending entries.')).toBeOnTheScreen();
  expect(screen.queryByText('Could not refresh unassigned entries.')).not.toBeOnTheScreen();
});

test('Assign person is disabled while a refresh reads and without saved people', async () => {
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue([row]);
  await renderScreen();
  await screen.findByText('Old loan');

  const refresh = Promise.withResolvers<Person[]>();
  jest.mocked(listPeople).mockReturnValue(refresh.promise);
  await act(async () => refreshQueries());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Assign person' })).toBeDisabled());

  await act(async () => refresh.resolve([]));
  expect(
    await screen.findByText('Save a person in Lending & borrowing before assigning history.'),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Assign person' })).toBeDisabled();
});

test('an assignment asks first, writes, and the refresh removes the entry', async () => {
  const user = userEvent.setup();
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue([row]);
  jest.mocked(assignLendingTransaction).mockImplementation(async () => {
    jest.mocked(listUnassignedLendingTransactions).mockResolvedValue([]);
    return { status: 'saved', id: 3 };
  });
  await renderScreen();

  await user.press(await screen.findByRole('button', { name: 'Assign person' }));
  await user.press(screen.getByRole('button', { name: 'Rafi' }));
  expect(alert.mock.calls.at(-1)?.[0]).toBe('Assign historical entry?');
  expect(assignLendingTransaction).not.toHaveBeenCalled();
  await chooseAlert('Assign');

  expect(assignLendingTransaction).toHaveBeenCalledWith(30, 1, { confirmOverpayment: false });
  expect(await screen.findByText('No unassigned historical lending entries.')).toBeOnTheScreen();
  expect(screen.queryByText('Old loan')).not.toBeOnTheScreen();
});

test('an overpayment asks again, and a failed write shows the error', async () => {
  const user = userEvent.setup();
  jest.mocked(listUnassignedLendingTransactions).mockResolvedValue([row]);
  const warning: LendingResult = {
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
        overpaidMinor: 500,
      },
    ],
  };
  jest
    .mocked(assignLendingTransaction)
    .mockResolvedValueOnce(warning)
    .mockRejectedValueOnce(new Error('Write failed'));
  await renderScreen();

  await user.press(await screen.findByRole('button', { name: 'Assign person' }));
  await user.press(screen.getByRole('button', { name: 'Rafi' }));
  await chooseAlert('Assign');
  expect(alert.mock.calls.at(-1)?.[0]).toBe('Overpayment warning');
  expect(alert.mock.calls.at(-1)?.[1]).toMatch(/USD: overpaid credit 5\.00/);
  // The first write changed no data, so the screen does not read again.
  expect(listUnassignedLendingTransactions).toHaveBeenCalledTimes(1);
  await chooseAlert('Assign anyway');

  expect(assignLendingTransaction).toHaveBeenLastCalledWith(30, 1, { confirmOverpayment: true });
  expect(await screen.findByText('Error: Write failed')).toBeOnTheScreen();
  expect(screen.getByText('Old loan')).toBeOnTheScreen();
});
