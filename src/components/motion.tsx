import { useEffect, useState, type ReactNode } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const roll = {
  duration: 700,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
};

function DigitWheel({ digit, style, height }: { digit: number; style: TextStyle; height: number }) {
  const offset = useSharedValue(-digit * height);
  useEffect(() => {
    offset.set(withTiming(-digit * height, roll));
  }, [digit, height, offset]);
  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));
  return (
    <View style={{ height, overflow: 'hidden' }}>
      <Animated.View style={wheelStyle}>
        {DIGITS.map((d) => (
          <Text key={d} style={[style, { height, lineHeight: height }]}>
            {d}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

/**
 * Shows the text with each digit on a wheel. When the value changes, each
 * digit rolls to its new value. The wheels are keyed from the right, so the
 * ones digit stays the same wheel when the text gets longer or shorter.
 */
export function RollingNumber({ value, style }: { value: string; style: TextStyle }) {
  const height = Math.round((style.fontSize ?? 14) * 1.25);
  const chars = [...value];
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={value}>
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{ flexDirection: 'row', alignItems: 'center' }}
      >
        {chars.map((char, i) => {
          const key = chars.length - i;
          const digit = DIGITS.indexOf(char);
          return digit === -1 ? (
            <Text key={`c${key}${char}`} style={[style, { height, lineHeight: height }]}>
              {char}
            </Text>
          ) : (
            <DigitWheel key={`d${key}`} digit={digit} style={style} height={height} />
          );
        })}
      </View>
    </View>
  );
}

/**
 * Returns a function that tells if a row is new since the last change of the
 * same list. On the first render, and when `listKey` changes, no row is new.
 * The previous ids are kept in state, so React Compiler can cache the result.
 */
export function useNewItems<T>(ids: readonly T[], listKey: unknown) {
  const signature = ids.join(',');
  const [seen, setSeen] = useState({
    key: listKey,
    signature,
    ids: new Set(ids),
    fresh: new Set<T>(),
  });
  if (seen.key !== listKey || seen.signature !== signature) {
    const sameList = seen.key === listKey;
    setSeen({
      key: listKey,
      signature,
      ids: new Set(ids),
      fresh: new Set(sameList ? ids.filter((id) => !seen.ids.has(id)) : []),
    });
  }
  return (id: T) => seen.fresh.has(id);
}

// The row starts above its place and slides down into it. The delay lets the
// add sheet close first, because the row mounts while the sheet still covers it.
const enter = FadeInUp.withInitialValues({ opacity: 0, transform: [{ translateY: -60 }] })
  .delay(300)
  .duration(400)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);

/** Slides and fades the children in on mount when `animate` is true. */
export function EnterView({ animate, children }: { animate: boolean; children: ReactNode }) {
  return <Animated.View entering={animate ? enter : undefined}>{children}</Animated.View>;
}
