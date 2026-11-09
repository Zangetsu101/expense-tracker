import { useState } from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import type { AppSheetProps } from '@/components/app-sheet';
import type { Account } from '@/lib/database';
import { HomeAccountPicker, HomeAccountPickerSkeleton } from './account-picker';

jest.mock('@/components/app-sheet', () => {
  const { Pressable, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AppSheet: ({ children, onDismiss }: AppSheetProps) => (
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

const accounts: Account[] = [
  { id: 2, name: 'Bank', currencyCode: 'BDT', isFavorite: 1 },
  { id: 3, name: 'Cash', currencyCode: 'USD', isFavorite: 0 },
];

test('searching by Account name selects a rendered result and closes the picker', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn<void, [number | null]>();
  await render(<HomeAccountPicker accounts={accounts} selectedId={null} onSelect={onSelect} />);

  await user.press(screen.getByRole('button', { name: 'Choose account, All accounts' }));
  await user.type(screen.getByLabelText('Find an account'), 'bank');

  expect(screen.queryByRole('button', { name: /^Cash/ })).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: /^Bank/ }));

  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith(2);
  expect(screen.queryByLabelText('Find an account')).not.toBeOnTheScreen();
});

test('search matches Currency regardless of case and surrounding spaces', async () => {
  const user = userEvent.setup();
  await render(<HomeAccountPicker accounts={accounts} selectedId={2} onSelect={jest.fn()} />);
  await user.press(screen.getByRole('button', { name: 'Choose account, Bank' }));
  await user.type(screen.getByLabelText('Find an account'), ' usd ');

  expect(screen.getByRole('button', { name: /^Cash/ })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /^Bank/ })).not.toBeOnTheScreen();
});

test('an unmatched search shows an empty result and clearing restores Accounts', async () => {
  const user = userEvent.setup();
  await render(<HomeAccountPicker accounts={accounts} selectedId={null} onSelect={jest.fn()} />);
  await user.press(screen.getByRole('button', { name: 'Choose account, All accounts' }));
  await user.type(screen.getByLabelText('Find an account'), 'missing');

  expect(screen.getByText('No matching accounts')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /^Bank/ })).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /^Cash/ })).not.toBeOnTheScreen();

  await user.clear(screen.getByLabelText('Find an account'));
  expect(screen.queryByText('No matching accounts')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /^Bank/ })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /^Cash/ })).toBeOnTheScreen();
});

test('All accounts clears the selection and the controlled label follows the parent', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn<void, [number | null]>();
  function Picker() {
    const [selectedId, setSelectedId] = useState<number | null>(2);
    return (
      <HomeAccountPicker
        accounts={accounts}
        selectedId={selectedId}
        onSelect={(id) => {
          onSelect(id);
          setSelectedId(id);
        }}
      />
    );
  }
  await render(<Picker />);
  await user.press(screen.getByRole('button', { name: 'Choose account, Bank' }));
  expect(screen.getByRole('button', { name: /^Bank/, selected: true })).toBeSelected();
  await user.press(screen.getByRole('button', { name: /^All accounts/ }));

  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith(null);
  expect(screen.getByRole('button', { name: 'Choose account, All accounts' })).toBeCollapsed();
  expect(screen.queryByLabelText('Find an account')).not.toBeOnTheScreen();
});

test('Done closes without selecting and reopening resets the search', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn();
  await render(<HomeAccountPicker accounts={accounts} selectedId={2} onSelect={onSelect} />);
  await user.press(screen.getByRole('button', { name: 'Choose account' }));
  await user.type(screen.getByLabelText('Find an account'), 'bank');
  await user.press(screen.getByRole('button', { name: 'Done' }));

  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Find an account')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Choose account, Bank' })).toBeCollapsed();

  await user.press(screen.getByRole('button', { name: 'Choose account, Bank' }));
  expect(screen.getByLabelText('Find an account')).toHaveDisplayValue('');
  expect(screen.getByRole('button', { name: /^Cash/ })).toBeOnTheScreen();
});

test('retrying a failed load and choosing another Account are separate actions', async () => {
  const user = userEvent.setup();
  const onRetry = jest.fn();
  await render(
    <HomeAccountPicker
      accounts={accounts}
      selectedId={2}
      onSelect={jest.fn()}
      error
      onRetry={onRetry}
    />,
  );
  await user.press(screen.getByRole('button', { name: 'Retry loading selected account' }));

  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Find an account')).not.toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Choose account, Bank' }));
  expect(screen.getByLabelText('Find an account')).toBeOnTheScreen();
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('loading exposes busy state while Account selection remains available', async () => {
  const user = userEvent.setup();
  await render(
    <HomeAccountPicker accounts={accounts} selectedId={2} onSelect={jest.fn()} loading />,
  );
  const chooser = screen.getByRole('button', { name: 'Choose account, Bank' });
  expect(chooser).toBeBusy();
  expect(chooser).toBeEnabled();

  await user.press(chooser);
  expect(screen.getByLabelText('Find an account')).toBeOnTheScreen();
});

test.each([true, false])(
  'the placeholder exposes no actions when animated is %s',
  async (animated) => {
    await render(<HomeAccountPickerSkeleton animated={animated} />);
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Find an account')).not.toBeOnTheScreen();
  },
);

test('dismissing the sheet closes it without changing the selected Account', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn();
  await render(<HomeAccountPicker accounts={accounts} selectedId={2} onSelect={onSelect} />);
  await user.press(screen.getByRole('button', { name: 'Choose account, Bank' }));
  await user.press(screen.getByRole('button', { name: 'Dismiss sheet' }));

  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Find an account')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Choose account, Bank' })).toBeCollapsed();
});
