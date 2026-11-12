import { useEffect } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import Animated, {
  Easing,
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
