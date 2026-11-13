import {
  cancelAnimation,
  ReduceMotion,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

const dimDelay = 100;
const minimumDimTime = 400;
const instant = { duration: 0, reduceMotion: ReduceMotion.Never };

export function updateListDimming(
  pending: boolean,
  opacity: SharedValue<number>,
  dimmedAt: SharedValue<number>,
) {
  'worklet';
  cancelAnimation(opacity);
  if (pending) {
    if (opacity.get() === 0.4) return;
    opacity.set(
      withDelay(
        dimDelay,
        withTiming(0.4, instant, (finished) => {
          if (finished) dimmedAt.set(performance.now());
        }),
        ReduceMotion.Never,
      ),
    );
  } else if (opacity.get() !== 1) {
    const remaining = Math.max(0, minimumDimTime - (performance.now() - dimmedAt.get()));
    opacity.set(withDelay(remaining, withTiming(1, instant), ReduceMotion.Never));
  }
}
