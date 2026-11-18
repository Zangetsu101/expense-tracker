import { render, screen, userEvent } from '@testing-library/react-native';
import { AccountSheet, HomeTitle } from './account-sheet';
import { deckCards, type DeckAccount } from './deck';

const bank: DeckAccount = {
  id: 2,
  name: 'Bank',
  currencyCode: 'BDT',
  balanceMinor: 1000,
  isFavorite: 1,
  lastUsedDay: null,
};
const mobile = { ...bank, id: 3, name: 'bKash', isFavorite: 0 };

test('lists accounts in deck order and forwards the chosen account or action', async () => {
  const user = userEvent.setup();
  const onSelect = jest.fn();
  const onAddAccount = jest.fn();
  const onDismiss = jest.fn();
  await render(
    <AccountSheet
      cards={deckCards([mobile, bank])}
      selectedId={2}
      {...{ onSelect, onAddAccount, onDismiss }}
    />,
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
  expect(onSelect.mock.calls).toEqual([[null], [3]]);
  expect(onAddAccount).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test('shows just the account and actions for a single account', async () => {
  await render(
    <AccountSheet
      cards={deckCards([bank])}
      selectedId={2}
      onSelect={jest.fn()}
      onAddAccount={jest.fn()}
      onDismiss={jest.fn()}
    />,
  );
  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
    'Done',
    'Bank',
    'Add account',
  ]);
});

test('the Home title names the current account and opens the list', async () => {
  const user = userEvent.setup();
  const open = jest.fn();
  await render(<HomeTitle name="Bank" onPress={open} />);
  await user.press(screen.getByRole('button', { name: 'Bank, choose account' }));
  expect(open).toHaveBeenCalledTimes(1);
});
