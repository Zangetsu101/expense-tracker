import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { withTiming } from 'react-native-reanimated';
import { AmountCalculator } from './amount-calculator';

jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  withTiming: jest.fn((value: number) => value),
}));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  performAndroidHapticsAsync: jest.fn(() => Promise.reject(new Error('Unavailable'))),
  impactAsync: jest.fn(() => Promise.reject(new Error('Unavailable'))),
}));

const key = (name: string) => screen.getByRole('button', { name });

test('keypad remains usable when haptics fail', async () => {
  const onKey = jest.fn();
  const onDone = jest.fn();
  const user = userEvent.setup();
  await render(<AmountCalculator error="" open bottomInset={24} onKey={onKey} onDone={onDone} />);
  await user.press(key('3'));
  await user.press(key('3'));
  expect(onKey.mock.calls).toEqual([['3'], ['3']]);
  await user.press(key('Done'));
  await user.press(key('Hide amount keypad'));
  expect(onDone).toHaveBeenCalledTimes(2);
  expect(Haptics.impactAsync).toHaveBeenCalled();
});

test('closed keypad hides controls and opening restores them', async () => {
  const props = { error: '', bottomInset: 24, onKey: jest.fn(), onDone: jest.fn() };
  const { rerender } = await render(<AmountCalculator {...props} open />);
  expect(key('3')).toBeOnTheScreen();
  await rerender(<AmountCalculator {...props} open={false} />);
  expect(screen.queryByRole('button', { name: '3' })).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Done' })).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Hide amount keypad' })).not.toBeOnTheScreen();
  await rerender(<AmountCalculator {...props} open />);
  expect(key('3')).toBeOnTheScreen();
});

test('pixel rounding does not restart opening but content size changes resize the panel', async () => {
  const props = { error: '', bottomInset: 24, onKey: jest.fn(), onDone: jest.fn() };
  const { rerender } = await render(<AmountCalculator {...props} open />);
  const measure = async (height: number) => {
    await fireEvent(screen.getByLabelText('Amount keypad').parent!, 'layout', {
      nativeEvent: { layout: { height } },
    });
  };
  await measure(332.952392578125);
  for (let cycle = 0; cycle < 5; cycle++) {
    await rerender(<AmountCalculator {...props} open={false} />);
    await rerender(<AmountCalculator {...props} open />);
    const started = jest.mocked(withTiming).mock.calls.length;
    await measure(333.33331298828125);
    await measure(332.952392578125);
    expect(jest.mocked(withTiming).mock.calls).toHaveLength(started);
  }
  await measure(360);
  expect(withTiming).toHaveBeenLastCalledWith(360, expect.any(Object));
});
