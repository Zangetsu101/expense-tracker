import { useState } from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import { FormButton, FormInput, JoinedChoice } from './form-controls';

test('Save accepts a press until it becomes busy', async () => {
  const user = userEvent.setup();
  const onPress = jest.fn();
  const { rerender } = await render(
    <FormButton label="Save" onPress={onPress} style={{ flex: 1 }} />,
  );
  const save = screen.getByRole('button', { name: 'Save' });
  expect(save).toHaveStyle({ flex: 1 });
  await user.press(save);
  await rerender(
    <FormButton label="Save" accessibilityLabel="Save category" loading onPress={onPress} />,
  );
  const busy = screen.getByRole('button', { name: 'Save category', busy: true });
  expect(busy).toBeDisabled();
  await user.press(busy);
  expect(onPress).toHaveBeenCalledTimes(1);
});

test.each(['secondary', 'danger'] as const)(
  'disabled %s actions ignore presses',
  async (variant) => {
    const user = userEvent.setup();
    const press = jest.fn();
    await render(<FormButton label="Action" disabled variant={variant} onPress={press} />);
    const action = screen.getByRole('button', { name: 'Action' });
    expect(action).toBeDisabled();
    await user.press(action);
    expect(press).not.toHaveBeenCalled();
  },
);

function Note({ editable }: { editable: boolean }) {
  const [value, setValue] = useState('draft');
  return (
    <FormInput
      accessibilityLabel="Note"
      value={value}
      onChangeText={setValue}
      editable={editable}
      multiline
      keyboardType="decimal-pad"
      style={{ minHeight: 100 }}
    />
  );
}

test('the note field accepts edits until locked and forwards native field options', async () => {
  const user = userEvent.setup();
  const { rerender } = await render(<Note editable />);
  const field = screen.getByLabelText('Note');
  expect(field).toHaveProp('keyboardType', 'decimal-pad');
  expect(field).toHaveProp('multiline', true);
  expect(field).toHaveStyle({ minHeight: 100 });
  await user.clear(field);
  await user.type(field, 'new');
  expect(field).toHaveDisplayValue('new');
  await rerender(<Note editable={false} />);
  await user.type(field, 'x');
  expect(field).toHaveDisplayValue('new');
});

const options = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
] as const;
function TypeChoice({ disabled }: { disabled: boolean }) {
  const [value, setValue] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  return (
    <JoinedChoice
      style={{ flex: 2 }}
      options={options}
      value={value}
      onChange={setValue}
      disabled={disabled}
    />
  );
}
test('switches the selected transaction type and locks both options when disabled', async () => {
  const user = userEvent.setup();
  const { rerender } = await render(<TypeChoice disabled={false} />);
  expect(screen.root).toHaveProp('accessibilityRole', 'radiogroup');
  expect(screen.root).toHaveStyle({ flex: 2 });
  const expense = screen.getByRole('radio', { name: 'Expense' });
  const income = screen.getByRole('radio', { name: 'Income' });
  expect(expense).toBeChecked();
  expect(income).not.toBeChecked();
  await user.press(income);
  expect(income).toBeChecked();
  expect(expense).not.toBeChecked();
  await rerender(<TypeChoice disabled />);
  expect(expense).toBeDisabled();
  expect(income).toBeDisabled();
  await user.press(expense);
  expect(income).toBeChecked();
});
