import { screen, userEvent, within, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AnimationClockProvider } from '@/components/animation-clock';
import { QueryTimeContext } from '@/lib/query-time';
import { renderWithQueries } from '@/test/render-with-queries';
import { homeDeckData, homeListPage, homePace, homeTrend } from './read-home';
import type { DeckAccount } from './deck';
import HomeScreen from './screen';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useIsFocused: () => true,
  useFocusEffect: () => {},
}));
jest.mock('@/components/app-sheet', () => {
  const { View, Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AppSheet: ({ children, onDismiss }: import('@/components/app-sheet').AppSheetProps) => (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss sheet"
          onPress={onDismiss}
        />
        {children}
      </View>
    ),
  };
});
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => false,
  useTimestamp: () => jest.requireActual('react-native-reanimated/mock').useSharedValue(0),
}));
jest.mock('@/lib/drive-backup-adapter', () => ({
  driveBackups: { status: async () => ({ status: 'disconnected' }) },
}));
jest.mock('@/lib/backup-background-task', () => ({ subscribeBackupSchedule: () => () => {} }));
jest.mock('./read-home', () => ({
  homeDeckData: jest.fn(),
  homeListPage: jest.fn(),
  homePace: jest.fn(),
  homeTrend: jest.fn(),
  homeSearch: jest.fn(async () => []),
  savePeriodSetting: jest.fn(),
}));

const bank: DeckAccount = {
  id: 1,
  name: 'Bank',
  currencyCode: 'BDT',
  balanceMinor: 30000,
  isFavorite: 1,
  lastUsedDay: null,
};
const visa: DeckAccount = {
  id: 2,
  name: 'Visa',
  currencyCode: 'BDT',
  balanceMinor: -11000,
  isFavorite: 0,
  lastUsedDay: null,
  bill: {
    accountId: 2,
    parentAccountId: 1,
    statementDay: 20,
    dueDay: 5,
    billMinor: 7000,
    owedMinor: 11000,
    unbilledMinor: 4000,
    creditMinor: 0,
    statementDate: 19990,
    dueDate: 20005,
    overdue: true,
  },
};

beforeEach(() => {
  jest.mocked(homeDeckData).mockResolvedValue({
    accounts: [bank, visa],
    displayRate: null,
    period: { range: 'month', monthStart: 1 },
  });
  jest.mocked(homeListPage).mockResolvedValue({
    periods: [{ period: { start: 20000, end: 20001, label: 'November' }, rows: [] }],
    firstDay: null,
    next: null,
  });
  jest.mocked(homePace).mockResolvedValue([]);
  jest.mocked(homeTrend).mockResolvedValue([30000, 30000]);
});
async function renderHome() {
  await renderWithQueries(
    <QueryTimeContext value={new Date(2026, 10, 14)}>
      <AnimationClockProvider>
        <HomeScreen />
      </AnimationClockProvider>
    </QueryTimeContext>,
  );
}

test('separates card bills from cash and Settle opens Quick add with the parent and bill', async () => {
  const user = userEvent.setup();
  await renderHome();
  const all = await screen.findByLabelText('All accounts');
  expect(within(all).getByLabelText('৳300.00')).toBeOnTheScreen();
  const card = screen.getByLabelText('Visa');
  expect(within(card).getByLabelText('৳70.00')).toBeOnTheScreen();
  expect(within(card).getByText('Not billed yet · ৳40.00')).toBeOnTheScreen();
  expect(within(card).getByText(/Overdue/)).toBeOnTheScreen();
  await user.press(within(card).getByRole('button', { name: 'Settle Visa' }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/quick-add',
    params: { mode: 'TRANSFER', accountId: '1', toId: '2', amountMinor: '7000' },
  });
});

test('shows overpayment as credit, excludes it from cash and offers no settlement', async () => {
  jest.mocked(homeDeckData).mockResolvedValue({
    accounts: [
      bank,
      {
        ...visa,
        balanceMinor: 5000,
        bill: {
          ...visa.bill!,
          billMinor: 0,
          owedMinor: 0,
          unbilledMinor: 0,
          creditMinor: 5000,
          overdue: false,
        },
      },
    ],
    displayRate: null,
    period: { range: 'month', monthStart: 1 },
  });
  await renderHome();
  const all = await screen.findByLabelText('All accounts');
  expect(within(all).getByLabelText('৳300.00')).toBeOnTheScreen();
  const card = screen.getByLabelText('Visa');
  expect(within(card).getByText('Credit')).toBeOnTheScreen();
  expect(within(card).getByLabelText('৳50.00')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Settle Visa' })).not.toBeOnTheScreen();
});

test('sums bills once per Currency without a Display Rate, on All accounts and the parent', async () => {
  const user = userEvent.setup();
  const usdParent = { ...bank, id: 3, name: 'USD bank', currencyCode: 'USD', isFavorite: 0 };
  const first = {
    ...visa,
    id: 4,
    name: 'First card',
    currencyCode: 'USD',
    bill: { ...visa.bill!, accountId: 4, parentAccountId: 3, billMinor: 1000 },
  };
  const second = {
    ...visa,
    id: 5,
    name: 'Second card',
    currencyCode: 'USD',
    bill: { ...visa.bill!, accountId: 5, parentAccountId: 3, billMinor: 2000 },
  };
  jest.mocked(homeDeckData).mockResolvedValue({
    accounts: [bank, usdParent, first, second],
    displayRate: null,
    period: { range: 'month', monthStart: 1 },
  });
  await renderHome();
  const all = await screen.findByLabelText('All accounts');
  const parent = screen.getByLabelText('USD bank');
  expect(within(all).getByRole('button', { name: 'Bills to settle $30.00' })).toBeOnTheScreen();
  await user.press(within(parent).getByRole('button', { name: 'Bills to settle $30.00' }));
  await user.press(
    within(await screen.findByLabelText('Bills to settle list')).getByRole('button', {
      name: 'Settle Second card',
    }),
  );
  await waitFor(() =>
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/quick-add',
      params: { mode: 'TRANSFER', accountId: '3', toId: '5', amountMinor: '2000' },
    }),
  );
});

test('converts the total of foreign-currency bills using Display Rate', async () => {
  const card = {
    ...visa,
    currencyCode: 'USD',
    bill: { ...visa.bill!, parentAccountId: null, billMinor: 3000 },
  };
  jest.mocked(homeDeckData).mockResolvedValue({
    accounts: [bank, card],
    displayRate: { base: 'USD', quote: 'BDT', rate: 120 },
    period: { range: 'month', monthStart: 1 },
  });
  await renderHome();
  const all = await screen.findByLabelText('All accounts');
  expect(
    within(all).getByRole('button', { name: 'Bills to settle ≈ ৳3,600.00' }),
  ).toBeOnTheScreen();
});
