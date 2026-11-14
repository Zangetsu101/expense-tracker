import { useState } from 'react';
import { render, screen, userEvent, fireEvent } from '@testing-library/react-native';
import type { ManagedCategory } from '@/lib/categories';
import { QuickSelectCategory } from './quick-select-category';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  const builder = { duration: () => builder, reduceMotion: () => builder };
  return {
    __esModule: true,
    default: { View },
    FadeOut: {},
    LinearTransition: builder,
    ReduceMotion: { System: 'system' },
  };
});

beforeEach(() => {
  jest
    .spyOn(jest.requireActual('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
});
afterEach(() => jest.restoreAllMocks());

const categories: ManagedCategory[] = ['Food', 'Travel', 'Coffee', 'Shopping'].map((name, i) => ({
  id: i + 1,
  name,
  type: 'EXPENSE',
  parentId: null,
  parentName: null,
  emoji: null,
  needsReview: 0,
}));
const names = () => screen.getAllByRole('button').map((button) => button.props.accessibilityLabel);
// RNTL does not run native layout. Deliver Yoga's result to the chip's measured wrapper.
const layout = async (name: string, y: number) => {
  let measured = screen.getByRole('button', { name, includeHiddenElements: true }).parent;
  while (measured && !measured.props.onLayout) measured = measured.parent;
  if (!measured) throw new Error(`No layout boundary for ${name}`);
  await fireEvent.layout(measured, { x: 0, y, width: 100, height: 40 });
};

test('ranked order changes preserve the selected Category', async () => {
  const onSelect = jest.fn();
  const props = { categories, selectedId: 2, onSelect };
  await render(<QuickSelectCategory {...props} />);
  expect(names()).toEqual(['Food', 'Travel', 'Coffee', 'Shopping']);
  await screen.rerender(<QuickSelectCategory {...props} orderedIds={[4, 3, 2, 1]} />);
  expect(names()).toEqual(['Shopping', 'Coffee', 'Travel', 'Food']);
  expect(screen.getByRole('button', { name: 'Travel', selected: true })).toBeOnTheScreen();
  expect(screen.getByText('Selected: Travel')).toBeOnTheScreen();
});

test('search matches parent paths and retains selection callbacks after reorder', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn();
  function Selection({ orderedIds }: { orderedIds?: number[] }) {
    const [selectedId, setSelectedId] = useState(2);
    return (
      <QuickSelectCategory
        categories={categories.map((c) => (c.id === 3 ? { ...c, parentId: 1 } : c))}
        orderedIds={orderedIds}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          onSelect(id);
        }}
      />
    );
  }
  await render(<Selection />);
  await user.type(screen.getByLabelText('Search categories'), 'food');
  expect(names()).toEqual(['Food', 'Food › Coffee']);
  await screen.rerender(<Selection orderedIds={[3, 4, 2, 1]} />);
  expect(names()).toEqual(['Food › Coffee', 'Food']);
  await user.press(screen.getByRole('button', { name: 'Food › Coffee' }));
  expect(onSelect).toHaveBeenCalledWith(3);
  expect(screen.getByRole('button', { name: 'Food › Coffee', selected: true })).toBeOnTheScreen();
  expect(screen.getByText('Selected: Food › Coffee')).toBeOnTheScreen();
  await user.clear(screen.getByLabelText('Search categories'));
  await user.type(screen.getByLabelText('Search categories'), 'absent');
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.getByText('No matching categories')).toBeOnTheScreen();
  expect(screen.getByText('Search its name to find its chip.')).toBeOnTheScreen();
});

test('third-row chips remain accessible, fourth-row chips are hidden, and search reveals them', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn();
  await render(<QuickSelectCategory categories={categories} selectedId={4} onSelect={onSelect} />);
  await layout('Coffee', 96);
  await layout('Shopping', 144);
  expect(screen.getByRole('button', { name: 'Coffee' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Shopping' })).toBeNull();
  expect(screen.getByText('Selected: Shopping')).toBeOnTheScreen();
  expect(screen.getByText('Search its name to find its chip.')).toBeOnTheScreen();
  await user.type(screen.getByLabelText('Search categories'), 'shopping');
  await layout('Shopping', 0);
  expect(names()).toEqual(['Shopping']);
  await user.press(screen.getByRole('button', { name: 'Shopping', selected: true }));
  expect(onSelect).toHaveBeenCalledWith(4);
});

test('disabled choices cannot be selected or searched', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn();
  await render(<QuickSelectCategory categories={categories} disabled onSelect={onSelect} />);
  expect(screen.getByLabelText('Search categories')).toBeDisabled();
  await user.press(screen.getByRole('button', { name: 'Food' }));
  expect(onSelect).not.toHaveBeenCalled();
});

test.each([
  { fontScale: 1, below: 135, at: 136, above: 137 },
  { fontScale: 2, below: 195, at: 196, above: 197 },
])(
  'clipping honors the boundary at font scale $fontScale',
  async ({ fontScale, below, at, above }) => {
    jest
      .spyOn(jest.requireActual('react-native'), 'useWindowDimensions')
      .mockReturnValue({ width: 390, height: 844, scale: 1, fontScale });
    await render(<QuickSelectCategory categories={categories} onSelect={jest.fn()} />);
    await layout('Food', below);
    await layout('Travel', at);
    await layout('Coffee', above);
    expect(screen.getByRole('button', { name: 'Food' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Travel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Coffee' })).toBeNull();
  },
);
