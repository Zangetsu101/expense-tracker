import { act, cleanup, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { notifyManager, type QueryClient } from '@tanstack/react-query';
import { AccessibilityInfo, Alert, BackHandler, Keyboard } from 'react-native';
import { router } from 'expo-router';
import { accountsQuery } from '@/lib/account-queries';
import { createQueryClient } from '@/lib/query-client';
import { epochDay, listAccounts } from '@/lib/database';
import { creditCardBills } from '@/lib/credit-cards';
import { notifyDataChanged } from '@/lib/data-changes';
import { loadFirstTransferRate } from '@/lib/transfer-rate-store';
import { addQuickTransaction } from '@/lib/quick-add-tags';
import { listCategoryEvidence } from '@/lib/category-prediction-history';
import { listCategoriesByRecentUse, type ManagedCategory } from '@/lib/categories';
import { listPeople, listLendingTotals, createPerson, saveLendingEntry } from '@/lib/lending';
import { usePreventRemove } from 'expo-router/react-navigation';
import { renderWithQueries } from '@/test/render-with-queries';
import { expenseReimbursements, expensesForReimbursement } from '@/features/home/read-home';
import type { ListRow } from '@/features/home/list';
import { categoriesQuery, peopleQuery } from './queries';
import QuickAdd from './screen';

const mockDispatch = jest.fn();
let mockParams: {
  personId?: string;
  action?: string;
  currency?: string;
  mode?: string;
  accountId?: string;
  toId?: string;
  amountMinor?: string;
} = {};

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  Stack: {
    Screen: ({
      options,
    }: {
      options: { headerTitleAlign?: string; headerLeft?: () => React.ReactNode };
    }) => (options.headerTitleAlign ? options.headerLeft?.() : null),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-router/react-navigation', () => ({
  useHeaderHeight: () => 0,
  useNavigation: () => ({ dispatch: mockDispatch }),
  usePreventRemove: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
  SafeAreaView: jest.requireActual<typeof import('react-native')>('react-native').View,
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
jest.mock('@/lib/database', () => ({
  ...jest.requireActual<typeof import('@/lib/database')>('@/lib/database'),
  listAccounts: jest.fn(),
}));
jest.mock('@/lib/credit-cards', () => ({ creditCardBills: jest.fn() }));
jest.mock('@/lib/transfer-rate-store', () => ({ loadFirstTransferRate: jest.fn() }));
jest.mock('@/features/home/read-home', () => ({
  expenseReimbursements: jest.fn(),
  expensesForReimbursement: jest.fn(),
}));
jest.mock('@/lib/quick-add-tags', () => ({ addQuickTransaction: jest.fn() }));
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
afterEach(async () => {
  await act(async () => {
    await cleanup();
  });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const accounts = [
  { id: 1, name: 'Cash', currencyCode: 'USD', isFavorite: 1 },
  { id: 2, name: 'Bank', currencyCode: 'USD', isFavorite: 0 },
];
const food: ManagedCategory = {
  id: 3,
  name: 'Food',
  type: 'EXPENSE',
  emoji: null,
  parentId: null,
  parentName: null,
  needsReview: 0,
};
const travel = { ...food, id: 4, name: 'Travel' };
const salary: ManagedCategory = { ...food, id: 5, name: 'Salary', type: 'INCOME' };
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  mockParams = { accountId: '1' };
  jest.mocked(listAccounts).mockReset().mockResolvedValue(accounts);
  jest
    .mocked(listCategoriesByRecentUse)
    .mockReset()
    .mockImplementation(async (type) => (type === 'INCOME' ? [salary] : [food, travel]));
  jest.mocked(listCategoryEvidence).mockResolvedValue([]);
  jest.mocked(listPeople).mockResolvedValue([{ id: 1, name: 'Rafi' }]);
  jest.mocked(listLendingTotals).mockResolvedValue([]);
  jest.mocked(creditCardBills).mockResolvedValue([]);
  jest.mocked(loadFirstTransferRate).mockResolvedValue({ base: 'USD', quote: 'BDT', rate: 122 });
});
const button = (name: string | RegExp) => screen.getByRole('button', { name });
async function open(client?: QueryClient) {
  const user = userEvent.setup();
  await act(async () => {
    await renderWithQueries(<QuickAdd />, client);
  });
  const press = (name: string) => user.press(button(name));
  const mode = (name: string) => user.press(screen.getByRole('radio', { name }));
  const type = (label: string, value: string) => user.type(screen.getByLabelText(label), value);
  const amount = async (keys: string[], done = true) => {
    await press('Amount');
    await press('Clear calculation');
    for (const key of keys) await press(key);
    if (done) await press('Done');
  };
  return { user, press, mode, type, amount };
}
test('ranking changes after Done and saving requires choosing a category', async () => {
  jest
    .mocked(listCategoryEvidence)
    .mockResolvedValue([
      { categoryId: 4, accountId: 1, amountMinor: 1200, day: epochDay(new Date()) },
    ]);
  const { amount, press, type } = await open();
  await screen.findByRole('button', { name: 'Food' });
  const order = () =>
    screen
      .getAllByRole('button', { name: /^(Travel|Food)$/ })
      .map((x) => x.props.accessibilityLabel);
  await amount(['1', '2'], false);
  expect(order()).toEqual(['Food', 'Travel']);
  await press('Done');
  await waitFor(() => expect(order()).toEqual(['Travel', 'Food']));
  expect(button('Save expense')).toBeDisabled();
  await press('Food');
  await type('Note', 'Lunch');
  await type('Tags, separated by commas', 'food');
  await press('Save expense');
  expect(addQuickTransaction).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'EXPENSE',
      amountMinor: 1200,
      accountId: 1,
      categoryId: 3,
      note: 'Lunch',
    }),
    'food',
  );
  expect(router.back).toHaveBeenCalled();
});
test.each([undefined, '99'])(
  'an absent or missing Home account (%s) requires an explicit choice',
  async (accountId) => {
    mockParams = { accountId };
    const { amount, press } = await open();
    await screen.findByRole('button', { name: 'Food' });
    await amount(['1']);
    await press('Food');
    expect(button('Save expense')).toBeDisabled();
    await press('Bank, USD');
    expect(button('Save expense')).toBeEnabled();
  },
);
test('refresh preserves the Home selection after a rename and allows changing accounts', async () => {
  mockParams = { accountId: '2' };
  const { amount, press } = await open();
  await screen.findByRole('button', { name: 'Bank, USD', selected: true });
  jest.mocked(listAccounts).mockResolvedValue([accounts[0], { ...accounts[1], name: 'Renamed' }]);
  await act(async () => notifyDataChanged());
  await screen.findByRole('button', { name: 'Renamed, USD', selected: true });
  await press('Cash, USD, favorite');
  await amount(['1']);
  await press('Food');
  await press('Save expense');
  expect(addQuickTransaction).toHaveBeenCalledWith(expect.objectContaining({ accountId: 1 }), '');
});
test('editing blocks stale submissions; hardware back commits the latest expression', async () => {
  const back = jest.spyOn(BackHandler, 'addEventListener');
  const keyboard = jest.spyOn(Keyboard, 'dismiss');
  const { amount, press } = await open();
  await screen.findByRole('button', { name: 'Food' });
  await press('Food');
  await amount(['1', '2']);
  await amount(['7', 'Add'], false);
  const active = back.mock.lastCall;
  await press('2');
  expect(back.mock.lastCall).toBe(active);
  expect(button('Save expense')).toBeDisabled();
  await press('Save expense');
  expect(addQuickTransaction).not.toHaveBeenCalled();
  expect(keyboard).toHaveBeenCalled();
  await act(() => {
    expect(active?.[1]({ type: 'hardwareBackPress', timeStamp: Date.now() })).toBe(true);
  });
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  await press('Save expense');
  expect(addQuickTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ amountMinor: 900 }),
    '',
  );
});
test('invalid expressions clear the amount; keypad errors can be corrected and scrolling commits', async () => {
  const { amount, press, user } = await open();
  await screen.findByRole('button', { name: 'Food' });
  await press('Food');
  await amount(['1', 'Divide', '0']);
  expect(button('Save expense')).toBeDisabled();
  expect(screen.getByText(/Enter a positive amount/)).toBeOnTheScreen();
  await amount(['1', 'Add', '3', 'Equals', '7']);
  expect(button('Amount')).toHaveAccessibilityValue({ text: '7.00' });
  await amount(['2', 'Divide', '0', 'Equals'], false);
  expect(screen.getByText('Cannot divide by zero.')).toBeOnTheScreen();
  await press('Backspace');
  await press('2');
  await press('Done');
  expect(button('Amount')).toHaveAccessibilityValue({ text: '1.00' });
  await press('Amount');
  await press('Add');
  await press('2');
  await user.scrollTo(screen.getByTestId('quick-add-form'), { y: 80 });
  expect(button('Amount')).toHaveAccessibilityValue({ text: '3.00' });
});
test('a rejected save keeps the draft and blocks another submission while pending', async () => {
  const { amount, press, type } = await open();
  await screen.findByRole('button', { name: 'Food' });
  await amount(['1', '2']);
  await press('Food');
  await type('Note', 'Draft');
  const request = Promise.withResolvers<Awaited<ReturnType<typeof addQuickTransaction>>>();
  jest.mocked(addQuickTransaction).mockReturnValueOnce(request.promise);
  await press('Save expense');
  await press('Save expense');
  expect(addQuickTransaction).toHaveBeenCalledTimes(1);
  expect(button('Save expense')).toBeBusy();
  const removal = jest.mocked(usePreventRemove).mock.lastCall;
  await act(() => removal?.[1]?.({ data: { action: { type: 'GO_BACK' } }, repeat: jest.fn() }));
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(jest.mocked(usePreventRemove).mock.lastCall?.[0]).toBe(true);
  await act(async () => request.reject(Error('Save failed')));
  expect(await screen.findByText(/Save failed/)).toBeOnTheScreen();
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Draft');
  expect(button('Amount')).toHaveAccessibilityValue({ text: '12.00' });
  expect(router.back).not.toHaveBeenCalled();
  await press('Save expense');
  expect(router.back).toHaveBeenCalled();
});
test('draft remains editable during independent account and category reads', async () => {
  const categories = Promise.withResolvers<ManagedCategory[]>();
  const bank = Promise.withResolvers<typeof accounts>();
  jest.mocked(listCategoriesByRecentUse).mockReturnValue(categories.promise);
  jest.mocked(listAccounts).mockReturnValue(bank.promise);
  const { amount, type, press } = await open();
  await amount(['1', '2']);
  await type('Note', 'Pending');
  expect(listPeople).not.toHaveBeenCalled();
  await act(async () => categories.resolve([food]));
  await press('Food');
  expect(button('Save expense')).toBeDisabled();
  await act(async () => bank.resolve(accounts));
  await press('Save expense');
  expect(addQuickTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ note: 'Pending', amountMinor: 1200 }),
    '',
  );
});
test('late Expense choices cannot enable Income or overwrite its selection', async () => {
  const pending = Promise.withResolvers<ManagedCategory[]>();
  jest
    .mocked(listCategoriesByRecentUse)
    .mockImplementation(async (type) => (type === 'INCOME' ? [salary] : pending.promise));
  const { amount, mode, press } = await open();
  await amount(['9']);
  await mode('Income');
  await screen.findByRole('button', { name: 'Salary' });
  expect(button('Save income')).toBeDisabled();
  await press('Salary');
  await act(async () => pending.resolve([food]));
  await mode('Expense');
  expect(button('Save expense')).toBeDisabled();
  await press('Food');
  jest
    .mocked(listCategoriesByRecentUse)
    .mockImplementation(async (type) => (type === 'INCOME' ? [salary] : []));
  await act(async () => notifyDataChanged());
  await waitFor(() => expect(button('Save expense')).toBeDisabled());
  await mode('Income');
  await screen.findByRole('button', { name: 'Salary', selected: true });
  await press('Save income');
  expect(addQuickTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'INCOME', categoryId: 5 }),
    '',
  );
});
test('a failed people read can recover on returning to Person with the draft intact', async () => {
  jest.mocked(listPeople).mockRejectedValueOnce(Error('offline'));
  const { amount, press, type, mode } = await open();
  await screen.findByRole('button', { name: 'Food' });
  await amount(['1']);
  await press('Food');
  await type('Note', 'Keep');
  await mode('Person');
  await screen.findByRole('button', { name: 'Retry people' });
  expect(button('Save lending')).toBeDisabled();
  await type('Search people', 'Ra');
  await mode('Expense');
  expect(button('Save expense')).toBeEnabled();
  await mode('Person');
  await screen.findByRole('button', { name: 'Rafi' });
  await press('Rafi');
  expect(button('Save lending')).toBeEnabled();
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Keep');
  expect(screen.getByLabelText('Search people')).toHaveDisplayValue('Ra');
  expect(listAccounts).toHaveBeenCalledTimes(1);
});
test('initial account errors offer Retry; refresh failures retain cached selections until removal', async () => {
  jest.mocked(listAccounts).mockRejectedValue(Error('offline'));
  const { amount, type, press } = await open();
  await screen.findByRole('button', { name: 'Retry accounts' });
  expect(screen.queryByRole('button', { name: /Cash, USD/ })).toBeNull();
  expect(button('Save expense')).toBeDisabled();
  jest.mocked(listAccounts).mockResolvedValue(accounts);
  await press('Retry accounts');
  await screen.findByRole('button', { name: /Cash, USD/ });
  await amount(['1']);
  await press('Food');
  await type('Note', 'Keep');
  jest.mocked(listAccounts).mockRejectedValueOnce(Error('offline'));
  await act(async () => notifyDataChanged());
  await screen.findByRole('button', { name: 'Retry accounts' });
  expect(button('Save expense')).toBeEnabled();
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Keep');
  jest.mocked(listAccounts).mockResolvedValue([accounts[1]]);
  await press('Retry accounts');
  await waitFor(() => expect(button('Save expense')).toBeDisabled());
  await press('Bank, USD');
  expect(button('Save expense')).toBeEnabled();
});
test('creating a person lets the user keep editing, disables save until settled, and maps the temporary ID', async () => {
  const { amount, press, type, mode } = await openWithChoices([{ id: 1, name: 'Rafi' }]);
  await amount(['8']);
  await type('Note', 'Person draft');
  await mode('Person');
  await type('Search people', 'New person');
  const person = Promise.withResolvers<{ id: number; name: string }>();
  jest.mocked(createPerson).mockReturnValueOnce(person.promise);
  await press('Add “New person”');
  const pendingChip = screen.getByRole('button', { name: 'New person', selected: true });
  expect(pendingChip).toBeEnabled();
  expect(pendingChip).toBeBusy();
  expect(screen.getByText('With New person')).toBeOnTheScreen();
  expect(button('Save lending')).toBeDisabled();
  expect(jest.mocked(usePreventRemove).mock.lastCall?.[0]).toBe(true);

  await type('Note', ' edited');
  await mode('Borrow');
  await amount(['1', '5']);
  expect(button('Save borrowing')).toBeDisabled();

  await type('Search people', 'Second person');
  expect(button('Add “Second person”')).toBeDisabled();
  await press('Add “Second person”');
  expect(createPerson).toHaveBeenCalledTimes(1);

  await act(async () => person.resolve({ id: 2, name: 'New person' }));
  await waitFor(() => expect(button('Save borrowing')).toBeEnabled());
  await fireEvent.changeText(screen.getByLabelText('Search people'), '');
  const savedChip = await screen.findByRole('button', { name: 'New person', selected: true });
  expect(savedChip).not.toBeBusy();

  jest.mocked(saveLendingEntry).mockResolvedValue({ status: 'saved', id: 1 });
  await press('Save borrowing');
  expect(saveLendingEntry).toHaveBeenCalledWith(
    expect.objectContaining({
      personId: 2,
      kind: 'BORROW',
      note: 'Person draft edited',
      amountMinor: 1500,
    }),
  );
});

test('a pending person creation preserves a switched selection and rolls back on failure', async () => {
  const { amount, press, type, mode } = await openWithChoices([{ id: 1, name: 'Rafi' }]);
  await amount(['8']);
  await mode('Person');
  await type('Search people', 'New person');
  const first = Promise.withResolvers<{ id: number; name: string }>();
  jest.mocked(createPerson).mockReturnValueOnce(first.promise);
  await press('Add “New person”');
  await type('Note', 'Keep draft');
  await act(async () => first.reject(Error('Create failed')));

  expect(await screen.findByText(/Create failed/)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'New person' })).toBeNull();
  expect(screen.getByText('With a person')).toBeOnTheScreen();
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Keep draft');
  expect(button('Save lending')).toBeDisabled();

  await type('Search people', 'Another');
  const second = Promise.withResolvers<{ id: number; name: string }>();
  jest.mocked(createPerson).mockReturnValueOnce(second.promise);
  await press('Add “Another”');
  await press('Rafi');
  expect(button('Save lending')).toBeDisabled();
  await act(async () => second.resolve({ id: 3, name: 'Another' }));

  expect(screen.getByRole('button', { name: 'Rafi', selected: true })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Another', selected: false })).toBeOnTheScreen();
  expect(button('Save lending')).toBeEnabled();
});
test('repayment confirmation resubmits the original draft only after Confirm', async () => {
  const { amount, press, mode } = await open();
  await amount(['1', '0']);
  await mode('Person');
  await press('Rafi');
  await mode('They paid back');
  const confirmation = {
    status: 'confirmation_required' as const,
    warnings: [
      {
        currencyCode: 'USD',
        direction: 'LENT' as const,
        personId: 1,
        principalMinor: 0,
        repaidMinor: 1000,
        writtenOffMinor: 0,
        outstandingMinor: 0,
        overpaidMinor: 1000,
      },
    ],
  };
  jest
    .mocked(saveLendingEntry)
    .mockResolvedValueOnce(confirmation)
    .mockResolvedValueOnce(confirmation)
    .mockResolvedValueOnce({ status: 'saved', id: 1 });
  async function chooseWarning(choice: 'Cancel' | 'Confirm') {
    await press('Save repayment received');
    const call = jest.mocked(Alert.alert).mock.lastCall;
    expect(call?.[0]).toBe('Overpayment warning');
    const selected = call?.[2]?.find((button) => button.text === choice);
    expect(selected?.onPress).toBeDefined();
    await act(async () => selected!.onPress!());
  }
  await chooseWarning('Cancel');
  expect(saveLendingEntry).toHaveBeenCalledTimes(1);
  expect(router.back).not.toHaveBeenCalled();
  await chooseWarning('Confirm');
  expect(saveLendingEntry).toHaveBeenCalledTimes(3);
  expect(jest.mocked(saveLendingEntry).mock.lastCall?.[0]).toEqual({
    ...jest.mocked(saveLendingEntry).mock.calls[0][0],
    confirmOverpayment: true,
  });
  expect(router.back).toHaveBeenCalled();
});
test('Quick add offers Transfer and Cancel returns to the previous screen', async () => {
  const { press } = await open();
  expect(screen.getByRole('radio', { name: 'Transfer' })).toBeEnabled();
  await press('Cancel');
  expect(router.back).toHaveBeenCalled();
});

test('opening a lending balance prefills the person and repayment action and filters accounts by currency', async () => {
  mockParams = { mode: 'PERSON', personId: '9', action: 'RECEIVE_REPAYMENT', currency: 'USD' };
  jest.mocked(listPeople).mockResolvedValue([{ id: 9, name: 'Sam' }]);
  jest
    .mocked(listAccounts)
    .mockResolvedValue([accounts[0], { ...accounts[1], currencyCode: 'BDT' }]);
  await open();
  expect(screen.getByRole('radio', { name: 'Person' })).toBeChecked();
  expect(await screen.findByText('With Sam')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'They paid back' })).toBeChecked();
  expect(button(/Cash, USD/)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Bank, BDT/ })).toBeNull();
});

function openWithChoices(people: Awaited<ReturnType<typeof listPeople>>) {
  const client = createQueryClient();
  client.setQueryData(accountsQuery().queryKey, accounts);
  client.setQueryData(categoriesQuery('EXPENSE').queryKey, [food, travel]);
  client.setQueryData(categoriesQuery('INCOME').queryKey, [salary]);
  client.setQueryData(peopleQuery().queryKey, { people, totals: [] });
  return open(client);
}

test('adds a split with fixed shares and allows shares above the account movement', async () => {
  const { amount, press } = await openWithChoices([
    { id: 1, name: 'Rafi' },
    { id: 2, name: 'Nabila' },
  ]);
  await screen.findByRole('button', { name: 'Food' });
  expect(screen.queryByLabelText('Find or add a person')).toBeNull();
  await amount(['3', '0']);
  await press('Food');
  await press('Split with people');
  await press('Rafi');
  await press('Nabila');
  expect(screen.getByLabelText('Share for Rafi')).toHaveDisplayValue('10.00');
  await fireEvent.changeText(screen.getByLabelText('Share for Rafi'), '40');
  expect(screen.getByText(/The shares are .* more than the expense/)).toBeOnTheScreen();
  expect(screen.getByLabelText('Share for Nabila')).toHaveDisplayValue('0.00');
  await press('Save expense');
  expect(addQuickTransaction).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'EXPENSE',
      amountMinor: 3000,
      shares: [
        { personId: 1, amountMinor: 4000 },
        { personId: 2, amountMinor: 0 },
      ],
    }),
    '',
  );
});

test('creating a person in Split lets the user edit shares while pending and maps the share to the saved ID', async () => {
  const { amount, press, type } = await openWithChoices([{ id: 1, name: 'Rafi' }]);
  await screen.findByRole('button', { name: 'Food' });
  await amount(['3', '0']);
  await press('Food');
  await press('Split with people');
  await press('Rafi');
  await type('Find or add a person', 'Sara');
  const person = Promise.withResolvers<{ id: number; name: string }>();
  jest.mocked(createPerson).mockReturnValueOnce(person.promise);
  await press('Add “Sara”');

  const pendingChip = screen.getByRole('button', { name: 'Sara', selected: true });
  expect(pendingChip).toBeEnabled();
  expect(pendingChip).toBeBusy();
  expect(button('Save expense')).toBeDisabled();
  expect(screen.getByLabelText('Share for Sara')).toHaveDisplayValue('10.00');

  await fireEvent.changeText(screen.getByLabelText('Share for Sara'), '12');
  await type('Note', 'Dinner split');
  expect(screen.getByLabelText('Share for Rafi')).toHaveDisplayValue('9.00');
  expect(button('Save expense')).toBeDisabled();

  await type('Find or add a person', 'Tariq');
  expect(button('Add “Tariq”')).toBeDisabled();
  await press('Add “Tariq”');
  expect(createPerson).toHaveBeenCalledTimes(1);

  await act(async () => person.resolve({ id: 7, name: 'Sara' }));
  await waitFor(() => expect(button('Save expense')).toBeEnabled());
  expect(screen.getByLabelText('Share for Sara')).toHaveDisplayValue('12');
  await fireEvent.changeText(screen.getByLabelText('Find or add a person'), '');
  expect(screen.getByRole('button', { name: 'Sara', selected: true })).not.toBeBusy();

  await press('Save expense');
  expect(addQuickTransaction).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'EXPENSE',
      amountMinor: 3000,
      note: 'Dinner split',
      shares: [
        { personId: 1, amountMinor: 900 },
        { personId: 7, amountMinor: 1200 },
      ],
    }),
    '',
  );
});

test('a failed person creation in Split rolls back the pending person and keeps other shares and edits', async () => {
  const { amount, press, type } = await openWithChoices([{ id: 1, name: 'Rafi' }]);
  await screen.findByRole('button', { name: 'Food' });
  await amount(['3', '0']);
  await press('Food');
  await press('Split with people');
  await press('Rafi');
  await type('Find or add a person', 'Sara');
  const person = Promise.withResolvers<{ id: number; name: string }>();
  jest.mocked(createPerson).mockReturnValueOnce(person.promise);
  await press('Add “Sara”');

  await fireEvent.changeText(screen.getByLabelText('Share for Sara'), '12');
  await fireEvent.changeText(screen.getByLabelText('Share for Rafi'), '10');
  await type('Note', 'Keep split');
  expect(button('Save expense')).toBeDisabled();

  await act(async () => person.reject(Error('Disk full')));
  expect(await screen.findByText(/Disk full/)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Sara' })).toBeNull();
  expect(screen.queryByLabelText('Share for Sara')).toBeNull();
  expect(screen.getByRole('button', { name: 'Rafi', selected: true })).toBeOnTheScreen();
  expect(screen.getByLabelText('Share for Rafi')).toHaveDisplayValue('10');
  expect(screen.getByLabelText('Note')).toHaveDisplayValue('Keep split');
  expect(button('Save expense')).toBeEnabled();

  await press('Save expense');
  expect(addQuickTransaction).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'EXPENSE',
      amountMinor: 3000,
      note: 'Keep split',
      shares: [{ personId: 1, amountMinor: 1000 }],
    }),
    '',
  );
});

test('links Income through the expense picker, fills the only outstanding share and saves an overpayment', async () => {
  const dinner: ListRow = {
    id: 40,
    type: 'EXPENSE',
    amountMinor: 3000,
    date: epochDay(new Date(2025, 10, 19)),
    accountId: 1,
    transferAccountId: null,
    accountName: 'Cash',
    transferAccountName: null,
    currencyCode: 'USD',
    categoryName: 'Dining out',
    parentCategoryName: 'Food',
    categoryEmoji: '🍽',
    note: 'Dinner',
    excludeFromReport: 0,
    owedMinor: 600,
  };
  const expenses = Promise.withResolvers<ListRow[]>();
  jest.mocked(expensesForReimbursement).mockReturnValueOnce(expenses.promise);
  jest.mocked(expenseReimbursements).mockResolvedValue({
    shares: [
      { personId: 1, name: 'Rafi', amountMinor: 1000, paidMinor: 400, leftMinor: 600 },
      { personId: 2, name: 'Nabila', amountMinor: 1000, paidMinor: 1000, leftMinor: 0 },
    ],
    payments: [],
  });
  const { mode, amount, press, user, type } = await openWithChoices([]);
  await mode('Income');
  await screen.findByRole('button', { name: 'Salary' });
  await amount(['2']);
  await press('Link to expense');
  expect(screen.getByText('Loading expenses…')).toBeOnTheScreen();
  await type('Search expenses', '19 Nov');
  await act(async () => expenses.resolve([dinner]));
  expect(screen.getByRole('header', { name: 'Still owed' })).toBeOnTheScreen();
  await user.press(await screen.findByRole('button', { name: /Food › Dining out, Dinner/ }));
  expect(screen.queryByRole('button', { name: 'Salary' })).toBeNull();
  expect(button('Amount')).toHaveAccessibilityValue({ text: '6.00' });
  await amount(['9']);
  expect(screen.getByText(/Rafi owes .* on this expense/)).toBeOnTheScreen();
  await press('Save reimbursement');
  expect(addQuickTransaction).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'INCOME',
      amountMinor: 900,
      categoryId: null,
      reimbursement: { expenseId: 40, personId: 1 },
    }),
    '',
  );
});
