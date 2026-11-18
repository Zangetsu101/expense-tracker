import { render, screen, userEvent } from '@testing-library/react-native';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AmountInput } from './amount-input';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));

async function renderAmountInput() {
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      <AmountInput currency="USD" onChange={() => {}}>
        {({ input, keypad }) => (
          <View>
            {input}
            {keypad}
          </View>
        )}
      </AmountInput>
    </SafeAreaProvider>,
  );
}
const key = (name: string) => screen.getByRole('button', { name });
const amount = () => screen.getByRole('button', { name: 'Amount' });

test('the keypad keys calculate the amount', async () => {
  const user = userEvent.setup();
  await renderAmountInput();

  await user.press(key('4'));
  await user.press(key('Add'));
  await user.press(key('5'));
  await user.press(key('Equals'));

  expect(amount()).toHaveAccessibilityValue({ text: '9.00' });
});
