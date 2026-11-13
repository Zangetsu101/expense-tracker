import { createContext, use, type ReactNode } from 'react';
// eslint-disable-next-line no-restricted-imports -- This provider owns the single app-wide frame clock.
import { useTimestamp, type SharedValue } from 'react-native-reanimated';

const AnimationClockContext = createContext<SharedValue<number> | null>(null);

export function AnimationClockProvider({ children }: { children: ReactNode }) {
  const clock = useTimestamp();
  return <AnimationClockContext value={clock}>{children}</AnimationClockContext>;
}

export function useAnimationClock() {
  const clock = use(AnimationClockContext);
  if (clock === null) throw new Error('AnimationClockProvider is missing');
  return clock;
}
