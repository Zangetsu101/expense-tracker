import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import {
  createCategory,
  listManagedCategories,
  renameCategory,
  type ManagedCategory,
} from '@/lib/categories';
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
  renameCategory: jest.fn(),
}));

const category = (id: number, name: string, type: ManagedCategory['type']): ManagedCategory => ({
  id,
  name,
  type,
  parentId: null,
  parentName: null,
  needsReview: 0,
});
const lunch = category(1, 'Lunch', 'EXPENSE');
const salary = category(2, 'Salary', 'INCOME');

beforeEach(() => {
  for (const mock of [listManagedCategories, createCategory, renameCategory])
    jest.mocked(mock).mockReset();
});

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

test('Add saves a root category, shows a notice, and the refresh shows the category', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedCategories).mockResolvedValueOnce([lunch]);
  const write = Promise.withResolvers<void>();
  jest.mocked(createCategory).mockReturnValue(write.promise);
  await renderScreen();

  await user.press(await screen.findByRole('button', { name: 'Add' }));
  await user.type(screen.getByLabelText('New category name'), 'Travel');
  await user.press(screen.getByRole('button', { name: 'Save' }));

  expect(createCategory).toHaveBeenCalledWith({ name: 'Travel', type: 'EXPENSE', parentId: null });
  expect(await screen.findByRole('button', { name: 'Saving…' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

  jest
    .mocked(listManagedCategories)
    .mockResolvedValueOnce([lunch, category(3, 'Travel', 'EXPENSE')]);
  await act(async () => write.resolve());

  expect(await screen.findByText('Travel added.')).toBeOnTheScreen();
  expect(screen.queryByLabelText('New category name')).not.toBeOnTheScreen();
  expect(await screen.findByRole('button', { name: /^Travel, EXPENSE/ })).toBeOnTheScreen();
  expect(listManagedCategories).toHaveBeenCalledTimes(2);
});

test('Edit renames the selected category', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedCategories).mockResolvedValueOnce([lunch]);
  jest.mocked(renameCategory).mockImplementation(async () => {
    jest.mocked(listManagedCategories).mockResolvedValueOnce([category(1, 'Dinner', 'EXPENSE')]);
  });
  await renderScreen();

  await user.longPress(await screen.findByRole('button', { name: /^Lunch, EXPENSE/ }));
  await user.press(screen.getByRole('button', { name: 'Edit' }));
  await user.clear(screen.getByLabelText('Category name'));
  await user.type(screen.getByLabelText('Category name'), 'Dinner');
  await user.press(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('Dinner renamed.')).toBeOnTheScreen();
  expect(renameCategory).toHaveBeenCalledWith(1, 'Dinner');
  expect(await screen.findByRole('button', { name: /^Dinner, EXPENSE/ })).toBeOnTheScreen();
});

test('a failed save keeps the form with the error, and a name change clears the error', async () => {
  const user = userEvent.setup();
  jest.mocked(listManagedCategories).mockResolvedValue([lunch]);
  jest.mocked(createCategory).mockRejectedValueOnce(new Error('Disk is full'));
  await renderScreen();

  await user.press(await screen.findByRole('button', { name: 'Add' }));
  await user.type(screen.getByLabelText('New category name'), 'Travel');
  await user.press(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('Disk is full')).toBeOnTheScreen();
  expect(screen.getByLabelText('New category name')).toHaveDisplayValue('Travel');
  expect(listManagedCategories).toHaveBeenCalledTimes(1);

  await user.type(screen.getByLabelText('New category name'), 's');
  expect(screen.queryByText('Disk is full')).not.toBeOnTheScreen();

  await user.clear(screen.getByLabelText('New category name'));
  await user.type(screen.getByLabelText('New category name'), 'Lunch');
  await user.press(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByText('A category with this name and type already exists.')).toBeOnTheScreen();
  expect(createCategory).toHaveBeenCalledTimes(1);
});
