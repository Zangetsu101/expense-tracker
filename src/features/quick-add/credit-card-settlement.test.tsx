import { act, screen, userEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { listAccounts } from '@/lib/database';
import { creditCardBills, type CardBill } from '@/lib/credit-cards';
import { notifyDataChanged } from '@/lib/data-changes';
import { addTransfer } from '@/lib/transfers';
import { renderWithQueries } from '@/test/render-with-queries';
import QuickAdd from './screen';

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ mode: 'TRANSFER', accountId: '1', toId: '2', amountMinor: '700' }),
}));
jest.mock('expo-router/react-navigation', () => ({
  useHeaderHeight: () => 0,
  useNavigation: () => ({ dispatch: jest.fn() }),
  usePreventRemove: () => {},
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/lib/database', () => ({
  ...jest.requireActual<typeof import('@/lib/database')>('@/lib/database'),
  listAccounts: jest.fn(),
}));
jest.mock('@/lib/credit-cards', () => ({ creditCardBills: jest.fn() }));
jest.mock('@/lib/transfers', () => ({ addTransfer: jest.fn() }));
jest.mock('@/lib/categories', () => ({ listCategoriesByRecentUse: jest.fn(async () => []) }));
jest.mock('@/lib/lending', () => ({
  listPeople: jest.fn(),
  listLendingTotals: jest.fn(),
  createPerson: jest.fn(),
  saveLendingEntry: jest.fn(),
}));
jest.mock('@/lib/category-prediction-history', () => ({ listCategoryEvidence: jest.fn() }));

beforeEach(() => {
  jest.mocked(listAccounts).mockResolvedValue([
    { id: 1, name: 'Parent', currencyCode: 'USD', isFavorite: 1 },
    { id: 2, name: 'Visa', currencyCode: 'USD', isFavorite: 0 },
    { id: 3, name: 'Another bank', currencyCode: 'USD', isFavorite: 0 },
  ]);
  jest.mocked(creditCardBills).mockResolvedValue([
    {
      accountId: 2,
      parentAccountId: 1,
      statementDay: 20,
      dueDay: 5,
      billMinor: 700,
      owedMinor: 1100,
      unbilledMinor: 400,
      creditMinor: 0,
      statementDate: 20000,
      dueDate: 20015,
      overdue: false,
    },
  ]);
  jest.mocked(addTransfer).mockResolvedValue(undefined);
});

test('Settle prefills Transfer and offers bill or all owed, paid from another Account', async () => {
  const user = userEvent.setup();
  await act(async () => {
    await renderWithQueries(<QuickAdd />);
  });
  expect(await screen.findByRole('radio', { name: 'Transfer' })).toBeChecked();
  expect(
    await screen.findByRole('button', { name: 'Visa, USD', selected: true }),
  ).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Amount' })).toHaveAccessibilityValue({ text: '7.00' });
  await user.press(await screen.findByRole('button', { name: 'All owed · $11.00' }));
  await user.press(
    within(screen.getByLabelText('Source account')).getByRole('button', {
      name: 'Another bank, USD',
    }),
  );
  expect(
    within(screen.getByLabelText('Transfer destination')).getByRole('button', {
      name: 'Visa, USD',
    }),
  ).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Save transfer' }));
  await waitFor(() =>
    expect(addTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 1100, fromAccountId: 3, toAccountId: 2 }),
    ),
  );
  expect(router.back).toHaveBeenCalled();
});

test('bill loading leaves the draft usable and a late result respects the destination in view', async () => {
  const user = userEvent.setup();
  const ready = await creditCardBills();
  const read = Promise.withResolvers<CardBill[]>();
  jest.mocked(creditCardBills).mockReturnValueOnce(read.promise);
  await act(async () => {
    await renderWithQueries(<QuickAdd />);
  });
  expect(await screen.findByLabelText('Loading card bills')).toBeOnTheScreen();
  await user.type(screen.getByLabelText('Note'), 'Keep my draft');
  await user.press(
    within(screen.getByLabelText('Transfer destination')).getByRole('button', {
      name: 'Another bank, USD',
    }),
  );
  await act(async () => read.resolve(ready));
  await waitFor(() => expect(screen.queryByLabelText('Loading card bills')).not.toBeOnTheScreen());
  expect(screen.queryByRole('button', { name: 'Bill · $7.00' })).not.toBeOnTheScreen();
  expect(
    within(screen.getByLabelText('Transfer destination')).getByRole('button', {
      name: 'Another bank, USD',
      selected: true,
    }),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Keep my draft');
  expect(screen.getByRole('button', { name: 'Amount' })).toHaveAccessibilityValue({ text: '7.00' });
  await user.press(
    within(screen.getByLabelText('Transfer destination')).getByRole('button', {
      name: 'Visa, USD',
    }),
  );
  expect(await screen.findByRole('button', { name: 'Bill · $7.00' })).toBeOnTheScreen();
});

test('retrying failed bills preserves the transaction draft and Account choices', async () => {
  const user = userEvent.setup();
  jest.mocked(creditCardBills).mockRejectedValueOnce(new Error('Read failed'));
  await act(async () => {
    await renderWithQueries(<QuickAdd />);
  });
  expect(await screen.findByText('Could not load card bills.')).toBeOnTheScreen();
  await user.type(screen.getByLabelText('Note'), 'Keep through retry');
  await user.press(screen.getByRole('button', { name: 'Retry card bills' }));
  expect(await screen.findByRole('button', { name: 'Bill · $7.00' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Keep through retry');
  expect(screen.getByRole('button', { name: 'Amount' })).toHaveAccessibilityValue({ text: '7.00' });
  expect(
    within(screen.getByLabelText('Transfer destination')).getByRole('button', {
      name: 'Visa, USD',
      selected: true,
    }),
  ).toBeOnTheScreen();
});

test('a failed bill refresh keeps the cached choices and draft visible', async () => {
  const user = userEvent.setup();
  await act(async () => {
    await renderWithQueries(<QuickAdd />);
  });
  await screen.findByRole('button', { name: 'Bill · $7.00' });
  await user.type(screen.getByLabelText('Note'), 'Keep through refresh');
  jest.mocked(creditCardBills).mockRejectedValueOnce(new Error('Refresh failed'));
  await act(async () => notifyDataChanged());
  expect(await screen.findByText('Could not load card bills.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Bill · $7.00' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Keep through refresh');
});
