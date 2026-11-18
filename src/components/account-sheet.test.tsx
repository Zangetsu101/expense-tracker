import { render, screen, userEvent } from '@testing-library/react-native';
import { AccountSheet, AccountTitle } from './account-sheet';

test('renders the supplied options in order and forwards their actions', async () => {
  const user = userEvent.setup();
  const onSelectAll = jest.fn();
  const onSelectMobile = jest.fn();
  const onAddAccount = jest.fn();
  const onDismiss = jest.fn();
  await render(
    <AccountSheet onAddAccount={onAddAccount} onDismiss={onDismiss}>
      <AccountSheet.Option name="All accounts" selected={false} onPress={onSelectAll} />
      <AccountSheet.Option name="Bank" detail="BDT" selected onPress={jest.fn()} />
      <AccountSheet.Option name="bKash" selected={false} onPress={onSelectMobile} />
    </AccountSheet>,
  );
  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
    'Done',
    'All accounts',
    'Bank',
    'bKash',
    'Add account',
  ]);
  expect(screen.getByRole('button', { name: 'Bank', selected: true })).toBeOnTheScreen();
  for (const name of ['All accounts', 'bKash', 'Add account', 'Done']) {
    await user.press(screen.getByRole('button', { name }));
  }
  expect(onSelectAll).toHaveBeenCalledTimes(1);
  expect(onSelectMobile).toHaveBeenCalledTimes(1);
  expect(onAddAccount).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test('shows just the account and actions for a single account', async () => {
  await render(
    <AccountSheet onAddAccount={jest.fn()} onDismiss={jest.fn()}>
      <AccountSheet.Option name="Bank" selected onPress={jest.fn()} />
    </AccountSheet>,
  );
  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
    'Done',
    'Bank',
    'Add account',
  ]);
});

test('the account title names the current account and opens the list', async () => {
  const user = userEvent.setup();
  const open = jest.fn();
  await render(<AccountTitle name="Bank" onPress={open} />);
  await user.press(screen.getByRole('button', { name: 'Bank, choose account' }));
  expect(open).toHaveBeenCalledTimes(1);
});
