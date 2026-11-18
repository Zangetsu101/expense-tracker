import { act, cleanup, screen, userEvent, waitFor, within } from '@testing-library/react-native';
import { notifyManager } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';
import { router } from 'expo-router';
import { epochDay, listAccounts } from '@/lib/database';
import { creditCardBills, type CardBill } from '@/lib/credit-cards';
import { notifyDataChanged } from '@/lib/data-changes';
import { loadFirstTransferRate } from '@/lib/transfer-rate-store';
import { addTransfer } from '@/lib/transfers';
import { renderWithQueries } from '@/test/render-with-queries';
import QuickAdd from './screen';
import { createQueryClient } from '@/lib/query-client';
import { accountsQuery } from '@/lib/account-queries';
import { cardBillsQuery, categoriesQuery } from './queries';

let mockParams: { mode?: string; accountId?: string; toId?: string; amountMinor?: string } = {};

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-router/react-navigation', () => ({
  useHeaderHeight: () => 0,
  useNavigation: () => ({ dispatch: jest.fn() }),
  usePreventRemove: () => {},
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@expo/ui/community/datetime-picker', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return function MockDatePicker({
    onValueChange,
  }: {
    onValueChange: (event: unknown, date: Date) => void;
  }) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose 1 January 2020"
        onPress={() => onValueChange({}, new Date(2020, 0, 1))}
      >
        <Text>1 January 2020</Text>
      </Pressable>
    );
  };
});
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/lib/database', () => ({
  ...jest.requireActual<typeof import('@/lib/database')>('@/lib/database'),
  listAccounts: jest.fn(),
}));
jest.mock('@/lib/credit-cards', () => ({ creditCardBills: jest.fn() }));
jest.mock('@/lib/transfer-rate-store', () => ({ loadFirstTransferRate: jest.fn() }));
jest.mock('@/lib/transfers', () => ({ addTransfer: jest.fn() }));
jest.mock('@/lib/categories', () => ({ listCategoriesByRecentUse: jest.fn(async () => []) }));
jest.mock('@/lib/lending', () => ({
  listPeople: jest.fn(),
  listLendingTotals: jest.fn(),
  createPerson: jest.fn(),
  saveLendingEntry: jest.fn(),
}));
jest.mock('@/lib/category-prediction-history', () => ({
  listCategoryEvidence: jest.fn(async () => []),
}));

beforeAll(() => notifyManager.setScheduler(queueMicrotask));
afterAll(() => notifyManager.setScheduler((callback) => setTimeout(callback, 0)));
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  mockParams = { mode: 'TRANSFER', accountId: '1', toId: '2', amountMinor: '700' };
  jest.mocked(loadFirstTransferRate).mockResolvedValue({ base: 'USD', quote: 'BDT', rate: 122 });
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

async function renderQuickAdd(deferBills = false) {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, staleTime: Infinity },
  });
  client.setQueryData(accountsQuery().queryKey, await listAccounts());
  client.setQueryData(categoriesQuery('EXPENSE').queryKey, []);
  if (!deferBills)
    client.setQueryData(cardBillsQuery(epochDay(new Date())).queryKey, await creditCardBills());
  return renderWithQueries(<QuickAdd />, client);
}

test('Settle prefills Transfer and offers bill or all owed, paid from another Account', async () => {
  const user = userEvent.setup();
  await act(async () => {
    await renderQuickAdd();
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
  await act(async () => {
    await cleanup();
  });
});

test('bill loading leaves the draft usable and a late result respects the destination in view', async () => {
  const user = userEvent.setup();
  const ready = await creditCardBills();
  const read = Promise.withResolvers<CardBill[]>();
  jest.mocked(creditCardBills).mockReturnValueOnce(read.promise);
  await act(async () => {
    await renderQuickAdd(true);
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
  await act(async () => {
    await cleanup();
  });
});

test('retrying failed bills preserves the transaction draft and Account choices', async () => {
  const user = userEvent.setup();
  const read = Promise.withResolvers<CardBill[]>();
  jest.mocked(creditCardBills).mockReturnValueOnce(read.promise);
  await act(async () => {
    await renderQuickAdd(true);
  });
  await act(async () => read.reject(new Error('Read failed')));
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
  await act(async () => {
    await cleanup();
  });
});

test('a failed bill refresh keeps the cached choices and draft visible', async () => {
  const user = userEvent.setup();
  await act(async () => {
    await renderQuickAdd();
  });
  await screen.findByRole('button', { name: 'Bill · $7.00' });
  await user.type(screen.getByLabelText('Note'), 'Keep through refresh');
  jest.mocked(creditCardBills).mockRejectedValueOnce(new Error('Refresh failed'));
  await act(async () => notifyDataChanged());
  expect(await screen.findByText('Could not load card bills.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Bill · $7.00' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Keep through refresh');
  await act(async () => {
    await cleanup();
  });
});

async function crossCurrencyAccounts() {
  jest.mocked(listAccounts).mockResolvedValue([
    { id: 1, name: 'Parent', currencyCode: 'BDT', isFavorite: 1 },
    { id: 2, name: 'Visa', currencyCode: 'USD', isFavorite: 0 },
    { id: 3, name: 'Another bank', currencyCode: 'BDT', isFavorite: 0 },
    { id: 4, name: 'Wise', currencyCode: 'USD', isFavorite: 0 },
  ]);
  await act(async () => {
    await renderQuickAdd();
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save transfer' })).toBeEnabled());
}
async function enter(user: ReturnType<typeof userEvent.setup>, field: string, digits: string) {
  await user.press(screen.getByRole('button', { name: field }));
  await user.press(screen.getByRole('button', { name: 'Clear calculation' }));
  for (const digit of digits) await user.press(screen.getByRole('button', { name: digit }));
  await user.press(screen.getByRole('button', { name: 'Done' }));
}
test('a cross-Currency Settle starts with a typed received Bill, and rate edits change pays', async () => {
  const user = userEvent.setup();
  await crossCurrencyAccounts();
  expect(screen.getByRole('button', { name: 'Visa receives' })).toHaveAccessibilityValue({
    text: '7.00',
  });
  expect(screen.getByRole('button', { name: 'Parent pays' })).toHaveAccessibilityValue({
    text: '854.00',
  });
  await enter(user, 'Rate', '125');
  expect(screen.getByRole('button', { name: 'Parent pays' })).toHaveAccessibilityValue({
    text: '875.00',
  });
  await user.press(screen.getByRole('button', { name: 'All owed · $11.00' }));
  expect(screen.getByRole('button', { name: 'Visa receives' })).toHaveAccessibilityValue({
    text: '11.00',
  });
  await user.press(screen.getByRole('button', { name: 'Save transfer' }));
  expect(addTransfer).toHaveBeenCalledWith(
    expect.objectContaining({ amountMinor: 137500, receivedAmountMinor: 1100 }),
  );
  await act(async () => {
    await cleanup();
  });
});
test('leaving Transfer mode keeps the amount paid in the single amount field', async () => {
  const user = userEvent.setup();
  await crossCurrencyAccounts();
  await user.press(screen.getByRole('radio', { name: 'Expense' }));
  expect(screen.getByRole('button', { name: 'Amount' })).toHaveAccessibilityValue({
    text: '854.00',
  });
  await enter(user, 'Amount', '9');
  await user.press(screen.getByRole('radio', { name: 'Transfer' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save transfer' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Parent pays' })).toHaveAccessibilityValue({
    text: '9.00',
  });
  expect(screen.getByRole('button', { name: 'Visa receives' })).toHaveAccessibilityValue({
    text: '0.07',
  });
  await act(async () => {
    await cleanup();
  });
});
test('two typed amounts update the rate; changing source preserves receives and destination discards it', async () => {
  const user = userEvent.setup();
  await crossCurrencyAccounts();
  await enter(user, 'Parent pays', '700');
  expect(screen.getByRole('button', { name: 'Visa receives' })).toHaveAccessibilityValue({
    text: '7.00',
  });
  expect(screen.getByText('100.00')).toBeOnTheScreen();
  await enter(user, 'Visa receives', '10');
  expect(screen.getByRole('button', { name: 'Parent pays' })).toHaveAccessibilityValue({
    text: '700.00',
  });
  expect(screen.getByText('70.00')).toBeOnTheScreen();
  await user.press(
    within(screen.getByLabelText('Source account')).getByRole('button', {
      name: 'Another bank, BDT',
    }),
  );
  expect(screen.getByRole('button', { name: 'Visa receives' })).toHaveAccessibilityValue({
    text: '10.00',
  });
  await enter(user, 'Visa receives', '20');
  expect(screen.getByRole('button', { name: 'Another bank pays' })).toHaveAccessibilityValue({
    text: '700.00',
  });
  await user.press(
    within(screen.getByLabelText('Transfer destination')).getByRole('button', {
      name: 'Wise, USD',
    }),
  );
  expect(screen.getByRole('button', { name: 'Wise receives' })).toHaveAccessibilityValue({
    text: '5.74',
  });
  await user.press(screen.getByRole('button', { name: 'Save transfer' }));
  expect(addTransfer).toHaveBeenCalledWith(
    expect.objectContaining({
      fromAccountId: 3,
      toAccountId: 4,
      amountMinor: 70000,
      receivedAmountMinor: 574,
    }),
  );
  await act(async () => {
    await cleanup();
  });
});
test('without a first rate a Settle cannot save until both amounts exist, and shows no historical hint', async () => {
  const user = userEvent.setup();
  jest
    .mocked(loadFirstTransferRate)
    .mockResolvedValue({ base: 'USD', quote: 'BDT', rate: undefined });
  jest.mocked(listAccounts).mockResolvedValue([
    { id: 1, name: 'Parent', currencyCode: 'BDT', isFavorite: 1 },
    { id: 2, name: 'Visa', currencyCode: 'USD', isFavorite: 0 },
  ]);
  await act(async () => {
    await renderQuickAdd();
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Parent pays' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Save transfer' })).toBeDisabled();
  expect(screen.queryByText(/from \d/)).not.toBeOnTheScreen();
  await enter(user, 'Parent pays', '854');
  expect(screen.getByRole('button', { name: 'Save transfer' })).toBeEnabled();
  expect(screen.getByText('122.00')).toBeOnTheScreen();
  await act(async () => {
    await cleanup();
  });
});

test('a new Transfer keeps the entered amount and saves date and tags with a destination in another Currency', async () => {
  const user = userEvent.setup();
  mockParams = { accountId: '1' };
  jest.mocked(loadFirstTransferRate).mockResolvedValue({ base: 'USD', quote: 'BDT', rate: 122 });
  jest.mocked(listAccounts).mockResolvedValue([
    { id: 1, name: 'Parent', currencyCode: 'BDT', isFavorite: 1 },
    { id: 2, name: 'Visa', currencyCode: 'USD', isFavorite: 0 },
  ]);
  await act(async () => {
    await renderQuickAdd();
  });
  await screen.findByRole('button', { name: 'Parent, BDT, favorite' });
  await enter(user, 'Amount', '854');
  await user.press(screen.getByRole('radio', { name: 'Transfer' }));
  await user.press(
    within(screen.getByLabelText('Transfer destination')).getByRole('button', {
      name: 'Visa, USD',
    }),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save transfer' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Visa receives' })).toHaveAccessibilityValue({
    text: '7.00',
  });
  await user.type(screen.getByLabelText('Tags, separated by commas'), 'move');
  await user.type(screen.getByLabelText('Note'), 'My transfer');
  await user.press(screen.getByRole('button', { name: 'Choose date…' }));
  await user.press(screen.getByRole('button', { name: 'Choose 1 January 2020' }));
  await user.press(screen.getByRole('button', { name: 'Save transfer' }));
  expect(addTransfer).toHaveBeenCalledWith(
    expect.objectContaining({
      amountMinor: 85400,
      receivedAmountMinor: 700,
      fromAccountId: 1,
      toAccountId: 2,
      note: 'My transfer',
      tagText: 'move',
      date: new Date(2020, 0, 1, 12),
    }),
  );
  await act(async () => {
    await cleanup();
  });
});

test('a historical first rate shows its date and an open draft keeps its amounts and direction through refresh', async () => {
  const user = userEvent.setup();
  jest
    .mocked(loadFirstTransferRate)
    .mockResolvedValue({ base: 'USD', quote: 'BDT', rate: 121.4, date: 20000 });
  await crossCurrencyAccounts();
  expect(screen.getByText(/\(from /)).toBeOnTheScreen();
  expect(screen.getByText('1 USD =')).toBeOnTheScreen();
  await enter(user, 'Parent pays', '840');
  expect(screen.getByText('120.00')).toBeOnTheScreen();
  jest.mocked(loadFirstTransferRate).mockResolvedValue({ base: 'BDT', quote: 'USD', rate: 0.01 });
  await act(async () => notifyDataChanged());
  await waitFor(() => expect(loadFirstTransferRate).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button', { name: 'Parent pays' })).toHaveAccessibilityValue({
    text: '840.00',
  });
  expect(screen.getByRole('button', { name: 'Visa receives' })).toHaveAccessibilityValue({
    text: '7.00',
  });
  expect(screen.getByText('120.00')).toBeOnTheScreen();
  expect(screen.getByText('1 USD =')).toBeOnTheScreen();
  expect(screen.queryByText(/\(from /)).not.toBeOnTheScreen();
  await act(async () => {
    await cleanup();
  });
});

test('after changing destination a rate edit keeps the calculated received amount', async () => {
  const user = userEvent.setup();
  await crossCurrencyAccounts();
  await user.press(
    within(screen.getByLabelText('Transfer destination')).getByRole('button', {
      name: 'Wise, USD',
    }),
  );
  await enter(user, 'Rate', '125');
  expect(screen.getByRole('button', { name: 'Wise receives' })).toHaveAccessibilityValue({
    text: '7.00',
  });
  expect(screen.getByRole('button', { name: 'Parent pays' })).toHaveAccessibilityValue({
    text: '875.00',
  });
  await act(async () => {
    await cleanup();
  });
});
