import { createContext, useState, type ReactElement, type ReactNode } from 'react';
import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert, BackHandler, Pressable } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { listAccounts, type Account } from '@/lib/database';
import { deleteTransaction } from '@/lib/transaction-delete';
import {
  loadEditableTransaction,
  saveTransactionEdit,
  type EditableTransaction,
} from '@/lib/transaction-edit';
import { loadTransfer, saveTransferEdit, type EditableTransfer } from '@/lib/transfers';
import { refreshQueries, renderWithQueries } from '@/test/render-with-queries';
import TransactionScreen from './screen';

type HeaderOptions = {
  title?: string;
  headerLeft?: () => ReactElement;
  headerRight?: () => ReactElement;
};
const MockParamsContext = createContext<{ id?: string }>({});
let mockHeader: HeaderOptions = {};
const mockNavigation = { dispatch: jest.fn(), goBack: jest.fn() };
jest.mock('expo-router', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useLocalSearchParams: () =>
      jest.requireActual<typeof import('react')>('react').use(MockParamsContext),
    Stack: {
      // Render the header controls so that tests can press them.
      Screen: ({ options }: { options: HeaderOptions }) => {
        mockHeader = options;
        return (
          <View accessibilityLabel="Header">
            {options.headerLeft?.()}
            {options.headerRight?.()}
          </View>
        );
      },
    },
  };
});
jest.mock('expo-router/react-navigation', () => ({
  useHeaderHeight: () => 88,
  useNavigation: () => mockNavigation,
  usePreventRemove: jest.fn(),
}));
jest.mock('@/lib/database', () => {
  const actual = jest.requireActual<typeof import('@/lib/database')>('@/lib/database');
  return {
    epochDay: actual.epochDay,
    dateFromEpochDay: actual.dateFromEpochDay,
    listAccounts: jest.fn(),
  };
});
jest.mock('@/lib/transaction-edit', () => ({
  loadEditableTransaction: jest.fn(),
  saveTransactionEdit: jest.fn(),
}));
jest.mock('@/lib/transfers', () => ({ loadTransfer: jest.fn(), saveTransferEdit: jest.fn() }));
jest.mock('@/lib/transaction-delete', () => ({ deleteTransaction: jest.fn() }));
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: { View },
    Easing: { out: (easing: unknown) => easing, cubic: (value: number) => value },
    ReduceMotion: { System: 'system' },
    useSharedValue: <T,>(value: T) => ({ value }),
    useAnimatedStyle: (style: () => object) => style(),
    withTiming: <T,>(value: T) => value,
  };
});
jest.mock('@/components/quick-add-date', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    QuickAddDate: ({
      value,
      onChange,
      disabled,
    }: {
      value: Date;
      onChange: (date: Date) => void;
      disabled?: boolean;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use 2 January 2024"
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={() => onChange(new Date(2024, 0, 2, 12))}
      >
        <Text>{value.toDateString()}</Text>
      </Pressable>
    ),
  };
});
jest.mock('@expo/ui', () => {
  const { Pressable, Switch, Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const Box = ({ children }: { children: ReactNode }) => <View>{children}</View>;
  return {
    Host: Box,
    Column: Box,
    Text: ({ children }: { children: ReactNode }) => <Text>{children}</Text>,
    Switch: ({
      label,
      value,
      onValueChange,
      disabled,
    }: {
      label: string;
      value: boolean;
      onValueChange: (value: boolean) => void;
      disabled?: boolean;
    }) => (
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      />
    ),
    BottomSheet: ({ children, isPresented }: { children: ReactNode; isPresented: boolean }) =>
      isPresented ? <View>{children}</View> : null,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} />
    ),
  };
});

const transaction: EditableTransaction = {
  id: 1,
  type: 'EXPENSE',
  amountMinor: 1000,
  currencyCode: 'USD',
  date: 20000,
  accountId: 1,
  categoryId: 3,
  accountName: 'Cash',
  categoryName: 'Food',
  note: '',
  tags: [],
  lineItems: [],
  excludeFromReport: 0,
  reportExclusionLocked: 0,
};
const transfer: EditableTransfer = {
  id: 1,
  type: 'TRANSFER',
  amountMinor: 500,
  date: 20000,
  fromAccountId: 1,
  fromAccountName: 'Cash',
  toAccountId: 2,
  toAccountName: 'Bank',
  currencyCode: 'USD',
  note: 'move',
};
const accounts: Account[] = [
  { id: 1, name: 'Cash', currencyCode: 'USD', isFavorite: 0 },
  { id: 2, name: 'Bank', currencyCode: 'USD', isFavorite: 0 },
  { id: 3, name: 'Card', currencyCode: 'EUR', isFavorite: 0 },
];

const safeArea = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

/** Renders the screen with a route param that test buttons can change. */
function Route({ initialId }: { initialId: string }) {
  const [id, setId] = useState(initialId);
  return (
    <MockParamsContext value={{ id }}>
      <SafeAreaProvider initialMetrics={safeArea}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open receipt 2"
          onPress={() => setId('2')}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open receipt 1"
          onPress={() => setId('1')}
        />
        <TransactionScreen />
      </SafeAreaProvider>
    </MockParamsContext>
  );
}

let alert: jest.SpyInstance<ReturnType<typeof Alert.alert>, Parameters<typeof Alert.alert>>;
let hardwareBack: Parameters<typeof BackHandler.addEventListener>[1] | undefined;
beforeEach(() => {
  for (const mock of [
    loadEditableTransaction,
    saveTransactionEdit,
    loadTransfer,
    saveTransferEdit,
    deleteTransaction,
    listAccounts,
    usePreventRemove,
    mockNavigation.dispatch,
    mockNavigation.goBack,
  ])
    jest.mocked(mock).mockReset();
  jest.mocked(loadEditableTransaction).mockResolvedValue(transaction);
  jest.mocked(loadTransfer).mockResolvedValue(null);
  jest.mocked(listAccounts).mockResolvedValue(accounts);
  mockHeader = {};
  hardwareBack = undefined;
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, handler) => {
    hardwareBack = handler;
    return { remove: () => {} };
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

async function renderScreen(id = '1') {
  const view = await renderWithQueries(<Route initialId={id} />);
  return view;
}

test('first load shows a skeleton, then the receipt with Edit', async () => {
  const read = Promise.withResolvers<EditableTransaction | null>();
  jest.mocked(loadEditableTransaction).mockReturnValue(read.promise);
  await renderScreen();

  expect(screen.getByLabelText('Loading receipt')).toBeOnTheScreen();
  expect(mockHeader.title).toBe('Receipt');
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeOnTheScreen();
  await act(async () => read.resolve({ ...transaction, note: 'Lunch' }));

  expect(screen.queryByLabelText('Loading receipt')).not.toBeOnTheScreen();
  expect(screen.getByText('Lunch')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
});

const noteInput = () => screen.getByLabelText('Note');
const headerCancel = () => screen.getAllByRole('button', { name: 'Cancel' })[0];
const bottomCancel = () => screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!;
const preventRemove = () => jest.mocked(usePreventRemove).mock.calls.at(-1)!;

async function chooseAlert(label: string) {
  const button = alert.mock.calls.at(-1)?.[2]?.find((item) => item.text === label);
  expect(button?.onPress).toBeDefined();
  await act(async () => button!.onPress!());
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.press(await screen.findByRole('button', { name: 'Edit' }));
}

async function pressHardwareBack() {
  expect(hardwareBack).toBeDefined();
  await act(async () => {
    hardwareBack!({} as Parameters<NonNullable<typeof hardwareBack>>[0]);
  });
}

describe('reads', () => {
  test('an invalid id shows Not found without a read', async () => {
    await renderScreen('abc');

    expect(screen.getByText('Transaction not found or cannot be viewed here.')).toBeOnTheScreen();
    expect(loadEditableTransaction).not.toHaveBeenCalled();
  });

  test('a missing Transaction shows Not found', async () => {
    jest.mocked(loadEditableTransaction).mockResolvedValue(null);
    await renderScreen();

    expect(
      await screen.findByText('Transaction not found or cannot be viewed here.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeOnTheScreen();
  });

  test('a failed load shows an error, and Retry shows the receipt', async () => {
    const user = userEvent.setup();
    jest.mocked(loadEditableTransaction).mockRejectedValueOnce(new Error('Read failed'));
    await renderScreen();

    expect(await screen.findByText('Could not load the receipt.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeOnTheScreen();
    expect(screen.queryByText('Could not load the receipt.')).not.toBeOnTheScreen();
  });

  test('a failed refresh keeps the receipt, disables Edit, and Retry reads again', async () => {
    const user = userEvent.setup();
    jest.mocked(loadEditableTransaction).mockResolvedValue({ ...transaction, note: 'Lunch' });
    await renderScreen();
    await screen.findByText('Lunch');

    jest.mocked(loadEditableTransaction).mockRejectedValue(new Error('Refresh failed'));
    await act(async () => refreshQueries());

    expect(await screen.findByText('Could not refresh the receipt.')).toBeOnTheScreen();
    expect(screen.getByText('Lunch')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    jest.mocked(loadEditableTransaction).mockResolvedValue({ ...transaction, note: 'Dinner' });
    await user.press(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Dinner')).toBeOnTheScreen();
    expect(screen.queryByText('Could not refresh the receipt.')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  test('a data change shows the new receipt and disables Edit while it reads', async () => {
    jest.mocked(loadEditableTransaction).mockResolvedValue({ ...transaction, note: 'Lunch' });
    await renderScreen();
    await screen.findByText('Lunch');

    const refresh = Promise.withResolvers<EditableTransaction | null>();
    jest.mocked(loadEditableTransaction).mockReturnValue(refresh.promise);
    await act(async () => refreshQueries());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled());

    await act(async () => refresh.resolve({ ...transaction, note: 'Dinner' }));
    expect(await screen.findByText('Dinner')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  test('a refresh does not change an open form', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await openEditor(user);
    await user.type(noteInput(), 'draft');

    jest.mocked(loadEditableTransaction).mockResolvedValue({ ...transaction, note: 'Elsewhere' });
    await act(async () => refreshQueries());
    await waitFor(() => expect(loadEditableTransaction).toHaveBeenCalledTimes(2));

    expect(noteInput()).toHaveDisplayValue('draft');
    expect(mockHeader.title).toBe('Edit transaction');
  });

  test('a receipt change during a pending read shows the new receipt, not a late old result', async () => {
    const user = userEvent.setup();
    const first = Promise.withResolvers<EditableTransaction | null>();
    const second = Promise.withResolvers<EditableTransaction | null>();
    jest
      .mocked(loadEditableTransaction)
      .mockImplementation((id) => (id === 1 ? first.promise : second.promise));
    await renderScreen();
    expect(screen.getByLabelText('Loading receipt')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Open receipt 2' }));
    expect(screen.getByLabelText('Loading receipt')).toBeOnTheScreen();
    await act(async () => second.resolve({ ...transaction, id: 2, note: 'Second' }));
    expect(await screen.findByText('Second')).toBeOnTheScreen();

    await act(async () => first.resolve({ ...transaction, note: 'First' }));
    expect(screen.getByText('Second')).toBeOnTheScreen();
    expect(screen.queryByText('First')).not.toBeOnTheScreen();
  });

  test('a return to a receipt whose read failed reads again', async () => {
    const user = userEvent.setup();
    jest.mocked(loadEditableTransaction).mockRejectedValueOnce(new Error('Read failed'));
    await renderScreen();
    expect(await screen.findByText('Could not load the receipt.')).toBeOnTheScreen();

    jest.mocked(loadEditableTransaction).mockResolvedValue({ ...transaction, note: 'Back' });
    await user.press(screen.getByRole('button', { name: 'Open receipt 2' }));
    expect(await screen.findByText('Back')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Open receipt 1' }));

    expect(await screen.findByText('Back')).toBeOnTheScreen();
    expect(screen.queryByText('Could not load the receipt.')).not.toBeOnTheScreen();
  });
});

describe('Transaction edit', () => {
  test('hardware back sees the current dirty draft, and Keep editing allows another confirmation', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await openEditor(user);
    await user.type(noteInput(), 'draft');

    await pressHardwareBack();
    expect(alert.mock.calls.at(-1)?.[0]).toBe('Discard changes?');
    await chooseAlert('Keep editing');
    alert.mockClear();
    await pressHardwareBack();
    expect(alert.mock.calls.at(-1)?.[0]).toBe('Discard changes?');
    await chooseAlert('Discard');

    expect(mockHeader.title).toBe('Receipt');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeOnTheScreen();
  });

  test('a navigation discard resumes the original action', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await openEditor(user);
    await user.type(screen.getByLabelText('Tags'), 'food');

    expect(preventRemove()[0]).toBe(true);
    await act(async () =>
      preventRemove()[1]({ data: { action: { type: 'GO_BACK' } } } as Parameters<
        Parameters<typeof usePreventRemove>[1]
      >[0]),
    );
    await chooseAlert('Discard');

    expect(mockNavigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  });

  test('a clean Cancel returns to the receipt without confirmation', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await openEditor(user);
    await user.press(bottomCancel());

    expect(alert).not.toHaveBeenCalled();
    expect(mockHeader.title).toBe('Receipt');
  });

  test('a save shows Saving until the one read of the new receipt arrives', async () => {
    const user = userEvent.setup();
    jest.mocked(saveTransactionEdit).mockResolvedValue(undefined);
    await renderScreen();
    await openEditor(user);
    await user.type(noteInput(), 'lunch');
    const reload = Promise.withResolvers<EditableTransaction | null>();
    jest.mocked(loadEditableTransaction).mockReturnValue(reload.promise);
    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeOnTheScreen();
    expect(mockHeader.title).toBe('Edit transaction');
    await act(async () => reload.resolve({ ...transaction, note: 'lunch' }));

    expect(await screen.findByText('lunch')).toBeOnTheScreen();
    expect(mockHeader.title).toBe('Receipt');
    expect(loadEditableTransaction).toHaveBeenCalledTimes(2);

    await openEditor(user);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeOnTheScreen();
    expect(noteInput()).toBeEnabled();
  });

  test('a failed read after a committed save keeps the draft locked, and Retry receipt does not save again', async () => {
    const user = userEvent.setup();
    jest.mocked(saveTransactionEdit).mockResolvedValue(undefined);
    await renderScreen();
    await openEditor(user);
    await user.type(noteInput(), 'draft');

    jest.mocked(loadEditableTransaction).mockRejectedValue(new Error('Reload failed'));
    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Error: Reload failed')).toBeOnTheScreen();
    expect(noteInput()).toHaveDisplayValue('draft');
    expect(noteInput()).not.toBeEnabled();
    expect(preventRemove()[0]).toBe(false);
    jest.mocked(loadEditableTransaction).mockResolvedValue({ ...transaction, note: 'draft' });
    await user.press(screen.getByRole('button', { name: 'Retry receipt' }));

    expect(saveTransactionEdit).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('draft')).toBeOnTheScreen();
    expect(mockHeader.title).toBe('Receipt');
  });

  for (const exit of ['header', 'back', 'bottom'] as const) {
    test(`after a committed save and a failed read, an exit by ${exit} shows the cached receipt with a refresh alert`, async () => {
      const user = userEvent.setup();
      jest.mocked(saveTransactionEdit).mockResolvedValue(undefined);
      await renderScreen();
      await openEditor(user);
      await user.type(noteInput(), 'saved note');
      jest.mocked(loadEditableTransaction).mockRejectedValue(new Error('Reload failed'));
      await user.press(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Error: Reload failed');

      if (exit === 'header') await user.press(headerCancel());
      else if (exit === 'back') await pressHardwareBack();
      else await user.press(bottomCancel());

      expect(alert).not.toHaveBeenCalled();
      expect(mockHeader.title).toBe('Receipt');
      expect(screen.getByText('Could not refresh the receipt.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
      jest
        .mocked(loadEditableTransaction)
        .mockResolvedValue({ ...transaction, note: 'saved note' });
      await user.press(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('saved note')).toBeOnTheScreen();
      await openEditor(user);
      expect(noteInput()).toHaveDisplayValue('saved note');
      expect(saveTransactionEdit).toHaveBeenCalledTimes(1);
    });
  }

  test('a pending save blocks back and navigation, and a failed save keeps a draft that can save again', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await openEditor(user);
    await user.type(noteInput(), 'draft');
    const save = Promise.withResolvers<void>();
    jest.mocked(saveTransactionEdit).mockReturnValue(save.promise);
    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(preventRemove()[0]).toBe(true);
    await pressHardwareBack();
    await act(async () =>
      preventRemove()[1]({ data: { action: { type: 'GO_BACK' } } } as Parameters<
        Parameters<typeof usePreventRemove>[1]
      >[0]),
    );
    expect(alert).not.toHaveBeenCalled();
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
    expect(noteInput()).not.toBeEnabled();
    await act(async () => save.reject(new Error('Save failed')));

    expect(await screen.findByText('Error: Save failed')).toBeOnTheScreen();
    expect(noteInput()).toHaveDisplayValue('draft');
    const reload = Promise.withResolvers<EditableTransaction | null>();
    jest.mocked(saveTransactionEdit).mockResolvedValue(undefined);
    jest.mocked(loadEditableTransaction).mockReturnValue(reload.promise);
    await user.press(screen.getByRole('button', { name: 'Save changes' }));
    await pressHardwareBack();
    expect(alert).not.toHaveBeenCalled();

    await act(async () => reload.resolve({ ...transaction, note: 'draft' }));
    expect(await screen.findByText('draft')).toBeOnTheScreen();
    expect(mockHeader.title).toBe('Receipt');
  });

  test('an invalid line item amount stays editable, and signed and zero items with quantities reach save', async () => {
    const user = userEvent.setup();
    jest.mocked(saveTransactionEdit).mockResolvedValue(undefined);
    await renderScreen();
    await openEditor(user);
    await user.press(screen.getByRole('button', { name: 'Add line item' }));
    await user.type(screen.getByLabelText('Line item 1 name'), 'Discount');
    await user.type(screen.getByLabelText('Line item 1 amount'), 'bad');
    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(saveTransactionEdit).not.toHaveBeenCalled();
    expect(mockHeader.title).toBe('Edit transaction');
    await user.clear(screen.getByLabelText('Line item 1 amount'));
    await user.type(screen.getByLabelText('Line item 1 amount'), '-1.25');
    await user.type(screen.getByLabelText('Line item 1 quantity'), '2');
    await user.press(screen.getByRole('button', { name: 'Add line item' }));
    await user.type(screen.getByLabelText('Line item 2 name'), 'Free');
    await user.type(screen.getByLabelText('Line item 2 amount'), '0');
    await user.type(screen.getByLabelText('Tags'), 'food, weekly');
    await fireEvent(screen.getByLabelText('Exclude from reports'), 'valueChange', true);
    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    const saved = jest.mocked(saveTransactionEdit).mock.calls[0];
    expect(saved[0]).toEqual(transaction);
    expect(saved[2]).toBe(true);
    expect(saved[3]).toBe('food, weekly');
    expect(saved[4]?.map((item) => [item.amountMinor, item.quantity])).toEqual([
      [-125, 2],
      [0, null],
    ]);
  });

  test('the amount uses the calculator keypad and reaches save', async () => {
    const user = userEvent.setup();
    jest.mocked(saveTransactionEdit).mockResolvedValue(undefined);
    await renderScreen();
    await openEditor(user);
    const amount = () => screen.getByRole('button', { name: 'Amount' });
    expect(amount()).toHaveAccessibilityValue({ text: '10.00' });
    expect(preventRemove()[0]).toBe(false);

    await user.press(amount());
    for (const key of ['Clear calculation', '0', 'Done'])
      await user.press(screen.getByRole('button', { name: key }));
    expect(screen.getByText(/positive amount/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.press(amount());
    for (const key of ['Clear calculation', '1', '2', '.', '5', 'Done'])
      await user.press(screen.getByRole('button', { name: key }));

    expect(amount()).toHaveAccessibilityValue({ text: '12.50' });
    expect(preventRemove()[0]).toBe(true);
    await user.press(screen.getByRole('button', { name: 'Save changes' }));
    expect(jest.mocked(saveTransactionEdit).mock.calls[0][5]).toBe(1250);
  });

  test('a lending Transaction shows a read-only amount', async () => {
    const user = userEvent.setup();
    jest
      .mocked(loadEditableTransaction)
      .mockResolvedValue({ ...transaction, lendingKind: 'LEND', personName: 'Sam' });
    await renderScreen();
    await openEditor(user);

    expect(screen.queryByRole('button', { name: 'Amount' })).not.toBeOnTheScreen();
    expect(screen.getByText(/from Lending/)).toBeOnTheScreen();
  });
});

describe('Delete', () => {
  test('Delete asks first, deletes a dirty draft, and closes without Not found', async () => {
    const user = userEvent.setup();
    jest.mocked(deleteTransaction).mockImplementation(async () => {
      jest.mocked(loadEditableTransaction).mockResolvedValue(null);
      return { status: 'deleted' };
    });
    await renderScreen();
    await openEditor(user);
    await user.type(noteInput(), 'draft');

    await user.press(screen.getByRole('button', { name: 'Delete transaction' }));
    expect(alert.mock.calls.at(-1)?.[0]).toBe('Delete transaction?');
    expect(deleteTransaction).not.toHaveBeenCalled();
    await chooseAlert('Delete');

    expect(deleteTransaction).toHaveBeenCalledWith(1, { confirmOverpayment: false });
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    expect(preventRemove()[0]).toBe(false);
    await waitFor(() => expect(loadEditableTransaction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(loadTransfer).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText('Transaction not found or cannot be viewed here.'),
    ).not.toBeOnTheScreen();
    expect(noteInput()).toHaveDisplayValue('draft');
  });

  test('a Delete of lending principal confirms the overpaid credit before it deletes', async () => {
    const user = userEvent.setup();
    jest.mocked(deleteTransaction).mockImplementation(async (_, options) =>
      options?.confirmOverpayment
        ? { status: 'deleted' }
        : {
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
                overpaidMinor: 250,
              },
            ],
          },
    );
    await renderScreen();
    await openEditor(user);
    await user.press(screen.getByRole('button', { name: 'Delete transaction' }));
    await chooseAlert('Delete');

    expect(alert.mock.calls.at(-1)?.[0]).toBe('Overpayment warning');
    expect(alert.mock.calls.at(-1)?.[1]).toMatch(/overpaid credit 2\.50/);
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
    await chooseAlert('Delete');

    expect(jest.mocked(deleteTransaction).mock.calls.map((call) => call[1])).toEqual([
      { confirmOverpayment: false },
      { confirmOverpayment: true },
    ]);
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });

  test('a failed Delete stays on the editor', async () => {
    const user = userEvent.setup();
    jest.mocked(deleteTransaction).mockRejectedValue(new Error('Delete failed'));
    await renderScreen();
    await openEditor(user);
    await user.press(screen.getByRole('button', { name: 'Delete transaction' }));
    await chooseAlert('Delete');

    expect(alert.mock.calls.at(-1)?.[0]).toBe('Could not delete');
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete transaction' })).toBeEnabled();
  });
});

describe('Transfer', () => {
  beforeEach(() => {
    jest.mocked(loadEditableTransaction).mockResolvedValue(null);
    jest.mocked(loadTransfer).mockResolvedValue(transfer);
  });

  test('a Transfer opens a read-only Transfer receipt with Edit', async () => {
    const user = userEvent.setup();
    await renderScreen();

    expect(await screen.findByText('Transfer · USD')).toBeOnTheScreen();
    expect(mockHeader.title).toBe('Receipt');
    await openEditor(user);

    expect(mockHeader.title).toBe('Edit transfer');
    expect(await screen.findByLabelText('Transfer amount')).toHaveDisplayValue('5.00');
  });

  test('the transfer edit shows a skeleton while the accounts load', async () => {
    const user = userEvent.setup();
    const read = Promise.withResolvers<Account[]>();
    jest.mocked(listAccounts).mockReturnValue(read.promise);
    await renderScreen();
    await openEditor(user);

    expect(screen.getByLabelText('Loading accounts')).toBeOnTheScreen();
    expect(headerCancel()).toBeEnabled();
    await act(async () => read.resolve(accounts));
    expect(screen.getByLabelText('Transfer amount')).toHaveDisplayValue('5.00');
  });

  test('a Transfer edit saves swapped accounts, amount, note and date, then shows the new receipt', async () => {
    const user = userEvent.setup();
    jest.mocked(saveTransferEdit).mockResolvedValue(undefined);
    await renderScreen();
    await openEditor(user);
    await user.clear(await screen.findByLabelText('Transfer amount'));
    await user.type(screen.getByLabelText('Transfer amount'), '7.5');
    await user.clear(noteInput());
    await user.type(noteInput(), 'rent');
    await user.press(screen.getByRole('button', { name: 'Swap accounts' }));
    await user.press(screen.getByRole('button', { name: 'Use 2 January 2024' }));
    jest.mocked(loadTransfer).mockResolvedValue({ ...transfer, amountMinor: 750, note: 'rent' });
    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(saveTransferEdit).toHaveBeenCalledWith(transfer, {
      amountMinor: 750,
      fromAccountId: 2,
      toAccountId: 1,
      note: 'rent',
      date: Math.floor(Date.UTC(2024, 0, 2) / 86400000),
    });
    expect(await screen.findByText('rent')).toBeOnTheScreen();
    expect(mockHeader.title).toBe('Receipt');
  });

  test('a committed Transfer save with a failed read locks the date and retries without saving again', async () => {
    const user = userEvent.setup();
    jest.mocked(saveTransferEdit).mockResolvedValue(undefined);
    await renderScreen();
    await openEditor(user);
    await user.clear(await screen.findByLabelText('Transfer amount'));
    await user.type(screen.getByLabelText('Transfer amount'), '9');
    jest.mocked(loadTransfer).mockRejectedValue(new Error('Reload failed'));
    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Reload failed')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Use 2 January 2024' })).toBeDisabled();
    expect(screen.getByLabelText('Transfer amount')).not.toBeEnabled();
    jest.mocked(loadTransfer).mockResolvedValue({ ...transfer, amountMinor: 900, note: 'nine' });
    await user.press(screen.getByRole('button', { name: 'Retry receipt' }));

    expect(saveTransferEdit).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('nine')).toBeOnTheScreen();
    expect(mockHeader.title).toBe('Receipt');
  });

  test('the destination choices leave out other currencies and the source', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await openEditor(user);
    await user.press(await screen.findByRole('button', { name: 'To account: Bank, USD' }));

    expect(screen.getByRole('button', { name: 'Bank · USD' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Card · EUR' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Cash · USD' })).not.toBeOnTheScreen();
  });

  test('a dirty Transfer edit asks before it discards, and a clean Cancel does not', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await openEditor(user);
    await screen.findByLabelText('Transfer amount');
    await user.press(bottomCancel());
    expect(alert).not.toHaveBeenCalled();
    expect(mockHeader.title).toBe('Receipt');

    await openEditor(user);
    await user.type(await screen.findByLabelText('Transfer amount'), '9');
    await pressHardwareBack();
    expect(alert.mock.calls.at(-1)?.[0]).toBe('Discard changes?');
    await chooseAlert('Discard');
    expect(mockHeader.title).toBe('Receipt');
  });

  test('a Transfer edit can delete the Transfer', async () => {
    const user = userEvent.setup();
    jest.mocked(deleteTransaction).mockResolvedValue({ status: 'deleted' });
    await renderScreen();
    await openEditor(user);
    await user.press(await screen.findByRole('button', { name: 'Delete transfer' }));
    await chooseAlert('Delete');

    expect(deleteTransaction).toHaveBeenCalledWith(1, { confirmOverpayment: false });
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });

  test('a failed Transfer save keeps the draft editable', async () => {
    const user = userEvent.setup();
    jest.mocked(saveTransferEdit).mockRejectedValue(new Error('Save failed'));
    await renderScreen();
    await openEditor(user);
    await user.clear(await screen.findByLabelText('Transfer amount'));
    await user.type(screen.getByLabelText('Transfer amount'), '9');
    await user.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Save failed')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Use 2 January 2024' })).toBeEnabled();
    expect(screen.getByLabelText('Transfer amount')).toHaveDisplayValue('9');
    expect(mockHeader.title).toBe('Edit transfer');

    await user.press(screen.getByRole('button', { name: 'Swap accounts' }));
    expect(screen.queryByText('Save failed')).not.toBeOnTheScreen();
  });
});
