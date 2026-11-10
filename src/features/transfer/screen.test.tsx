import type { ReactNode } from 'react';
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { listAccounts, type Account } from '@/lib/database';
import { notifyDataChanged } from '@/lib/data-changes';
import { addTransfer } from '@/lib/transfers';
import { renderWithQueries } from '@/test/render-with-queries';
import TransferScreen from './screen';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('@/lib/database', () => ({ listAccounts: jest.fn() }));
jest.mock('@/lib/transfers', () => ({ addTransfer: jest.fn() }));
jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Host: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    Column: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    Text: ({ children }: { children: ReactNode }) => <Text>{children}</Text>,
    BottomSheet: ({ children, isPresented }: { children: ReactNode; isPresented: boolean }) =>
      isPresented ? <View>{children}</View> : null,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} />
    ),
  };
});

const accounts: Account[] = [
  { id: 1, name: 'Cash', currencyCode: 'USD', isFavorite: 1 },
  { id: 2, name: 'Bank', currencyCode: 'USD', isFavorite: 0 },
  { id: 4, name: 'Foreign', currencyCode: 'BDT', isFavorite: 0 },
];

beforeEach(() => {
  jest.mocked(listAccounts).mockReset();
  jest.mocked(addTransfer).mockReset();
  jest.mocked(router.back).mockReset();
});

async function renderScreen() {
  const view = await renderWithQueries(<TransferScreen />);
  return view;
}

test('first load shows a skeleton, then the form with the first account as the source', async () => {
  const read = Promise.withResolvers<Account[]>();
  jest.mocked(listAccounts).mockReturnValue(read.promise);
  await renderScreen();

  expect(screen.getByLabelText('Loading accounts')).toBeOnTheScreen();
  await act(async () => read.resolve(accounts));

  expect(screen.queryByLabelText('Loading accounts')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'From account: Cash, USD' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'To account: Not selected' })).toBeOnTheScreen();
});

test('a failed first load shows an error, and Retry shows the form', async () => {
  const user = userEvent.setup();
  jest.mocked(listAccounts).mockRejectedValueOnce(new Error('Read failed'));
  await renderScreen();

  expect(await screen.findByText('Could not load accounts.')).toBeOnTheScreen();
  expect(screen.getByText('Move money between your accounts.')).toBeOnTheScreen();
  jest.mocked(listAccounts).mockResolvedValue(accounts);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByRole('button', { name: 'From account: Cash, USD' })).toBeOnTheScreen();
  expect(screen.queryByText('Could not load accounts.')).not.toBeOnTheScreen();
});

test('choosing a destination enables Save and saves the direction of the transfer', async () => {
  const user = userEvent.setup();
  jest.mocked(listAccounts).mockResolvedValue(accounts);
  jest.mocked(addTransfer).mockResolvedValue(undefined);
  await renderScreen();

  await user.type(await screen.findByLabelText('Transfer amount'), '7');
  expect(screen.getByRole('button', { name: 'Save transfer' })).toBeDisabled();
  await user.press(screen.getByRole('button', { name: 'To account: Not selected' }));
  expect(screen.queryByRole('button', { name: 'Foreign · BDT' })).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Bank · USD' }));
  await user.press(screen.getByRole('button', { name: 'Save transfer' }));

  expect(addTransfer).toHaveBeenCalledWith({
    amountMinor: 700,
    fromAccountId: 1,
    toAccountId: 2,
    note: '',
  });
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('a failed refresh keeps the draft, shows an alert, and Retry clears it', async () => {
  const user = userEvent.setup();
  jest.mocked(listAccounts).mockResolvedValue(accounts);
  await renderScreen();
  await user.type(await screen.findByLabelText('Transfer amount'), '12');

  jest.mocked(listAccounts).mockRejectedValue(new Error('Refresh failed'));
  await act(async () => notifyDataChanged());

  expect(await screen.findByText('Could not refresh accounts.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Transfer amount')).toHaveDisplayValue('12');
  expect(screen.getByRole('button', { name: 'From account: Cash, USD' })).toBeOnTheScreen();

  jest.mocked(listAccounts).mockResolvedValue(accounts);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  await screen.findByRole('button', { name: 'From account: Cash, USD' });
  expect(screen.queryByText('Could not refresh accounts.')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Transfer amount')).toHaveDisplayValue('12');
});

test('a data change shows new accounts, keeps the draft, and disables Save while it reads', async () => {
  const user = userEvent.setup();
  jest.mocked(listAccounts).mockResolvedValue(accounts);
  await renderScreen();
  await user.type(await screen.findByLabelText('Transfer amount'), '5');
  await user.press(screen.getByRole('button', { name: 'To account: Not selected' }));
  await user.press(screen.getByRole('button', { name: 'Bank · USD' }));
  expect(screen.getByRole('button', { name: 'Save transfer' })).toBeEnabled();

  const refresh = Promise.withResolvers<Account[]>();
  jest.mocked(listAccounts).mockReturnValue(refresh.promise);
  await act(async () => notifyDataChanged());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save transfer' })).toBeDisabled());

  await act(async () =>
    refresh.resolve(accounts.map((a) => (a.id === 2 ? { ...a, name: 'Savings' } : a))),
  );

  expect(await screen.findByRole('button', { name: 'To account: Savings, USD' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Transfer amount')).toHaveDisplayValue('5');
  expect(screen.getByRole('button', { name: 'Save transfer' })).toBeEnabled();
});
