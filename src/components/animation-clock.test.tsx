import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useTimestamp } from 'react-native-reanimated';
import { AnimationClockProvider, useAnimationClock } from './animation-clock';

jest.mock('react-native-reanimated', () => ({
  useTimestamp: jest.fn(() => ({ get: () => 42 })),
}));

function ClockReader({ name }: { name: string }) {
  const clock = useAnimationClock();
  return <Text>{`${name}: ${clock.get()}`}</Text>;
}

test('multiple consumers share one timestamp provider', async () => {
  const content = (
    <AnimationClockProvider>
      <ClockReader name="First" />
      <ClockReader name="Second" />
    </AnimationClockProvider>
  );
  await render(content);
  expect(screen.getByText('First: 42')).toBeOnTheScreen();
  expect(screen.getByText('Second: 42')).toBeOnTheScreen();
  expect(useTimestamp).toHaveBeenCalledTimes(1);
});
