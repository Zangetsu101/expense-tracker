import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { listManagedCategories, type ManagedCategory } from '@/lib/categories';
import { notifyDataChanged } from '@/lib/data-changes';
import { renderWithQueries } from '@/test/render-with-queries';
import { CategoriesScreen } from './index';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/app-sheet', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { AppSheet: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('@/lib/categories', () => ({
  listManagedCategories: jest.fn(),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
}));

const category = (id: number, name: string, type: ManagedCategory['type']): ManagedCategory => ({
  id,
  name,
  type,
  parentId: null,
  parentName: null,
  emoji: null,
  needsReview: 0,
});
const lunch = category(1, 'Lunch', 'EXPENSE');
const salary = category(2, 'Salary', 'INCOME');

beforeEach(() => jest.mocked(listManagedCategories).mockReset());

async function renderScreen() {
  const view = await renderWithQueries(<CategoriesScreen />);
  return view;
}

test('first load shows a skeleton and then the categories', async () => {
  const read = Promise.withResolvers<ManagedCategory[]>();
  jest.mocked(listManagedCategories).mockReturnValue(read.promise);
  await renderScreen();

  expect(screen.getByLabelText('Loading categories')).toBeOnTheScreen();
  await act(async () => read.resolve([lunch]));

  expect(screen.queryByLabelText('Loading categories')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /^Lunch, EXPENSE/ })).toBeOnTheScreen();
});

test('a failed first load shows an error, and Retry reads again', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedCategories).mockRejectedValueOnce(new Error('Disk error'));
  await renderScreen();

  expect(await screen.findByText('Could not load categories.')).toBeOnTheScreen();
  jest.mocked(listManagedCategories).mockResolvedValueOnce([lunch]);
  await user.press(screen.getByRole('button', { name: 'Retry loading categories' }));

  expect(await screen.findByRole('button', { name: /^Lunch, EXPENSE/ })).toBeOnTheScreen();
  expect(screen.queryByText('Could not load categories.')).not.toBeOnTheScreen();
});

test('a data change shows the new categories and keeps the search text', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedCategories).mockResolvedValueOnce([lunch, salary]);
  await renderScreen();
  await user.type(await screen.findByLabelText('Search categories'), 'Lun');

  const refresh = Promise.withResolvers<ManagedCategory[]>();
  jest.mocked(listManagedCategories).mockReturnValueOnce(refresh.promise);
  await act(async () => notifyDataChanged());

  await waitFor(() => expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled());
  expect(screen.getByRole('button', { name: /^Lunch, EXPENSE/ })).toBeOnTheScreen();
  expect(screen.queryByLabelText('Loading categories')).not.toBeOnTheScreen();

  await act(async () => refresh.resolve([lunch, category(3, 'Lunch out', 'EXPENSE')]));

  expect(await screen.findByRole('button', { name: /^Lunch out, EXPENSE/ })).toBeOnTheScreen();
  expect(screen.getByLabelText('Search categories')).toHaveDisplayValue('Lun');
  expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
});

test('a data change to an empty list replaces the categories', async () => {
  jest.mocked(listManagedCategories).mockResolvedValueOnce([lunch]);
  await renderScreen();
  await screen.findByRole('button', { name: /^Lunch, EXPENSE/ });

  jest.mocked(listManagedCategories).mockResolvedValueOnce([]);
  await act(async () => notifyDataChanged());

  expect(
    await screen.findByText('No categories yet. Use Add to create a root category.'),
  ).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /^Lunch, EXPENSE/ })).not.toBeOnTheScreen();
});

test('a failed refresh keeps the categories and shows an alert with Retry', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedCategories).mockResolvedValueOnce([lunch]);
  await renderScreen();
  await screen.findByRole('button', { name: /^Lunch, EXPENSE/ });

  jest.mocked(listManagedCategories).mockRejectedValueOnce(new Error('Disk error'));
  await act(async () => notifyDataChanged());

  expect(await screen.findByText('Could not refresh categories.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /^Lunch, EXPENSE/ })).toBeOnTheScreen();

  jest.mocked(listManagedCategories).mockResolvedValueOnce([lunch, salary]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByRole('button', { name: /^Salary, INCOME/ })).toBeOnTheScreen();
  expect(screen.queryByText('Could not refresh categories.')).not.toBeOnTheScreen();
});
