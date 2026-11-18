import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Touchable } from 'react-native-gesture-handler';
import { SymbolView } from 'expo-symbols';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { theme } from '@/theme';

const rows = [
  ['C', '÷', '×', '⌫'],
  ['7', '8', '9', '−'],
  ['4', '5', '6', '+'],
  ['1', '2', '3', '='],
  ['.', '0', 'Done'],
];
const labels: Record<string, string> = {
  C: 'Clear calculation',
  '⌫': 'Backspace',
  '÷': 'Divide',
  '×': 'Multiply',
  '−': 'Subtract',
  '+': 'Add',
  '=': 'Equals',
};
const c = theme.colors;

export function AmountCalculator({
  error,
  onKey,
  onDone,
  open,
  bottomInset,
}: {
  /** The message from the last calculation that failed. */
  error: string;
  /** Receives each key that changes the amount, such as `7`, `+`, `=`, `C` or `⌫`. */
  onKey: (key: string) => void;
  onDone: () => void;
  open: boolean;
  bottomInset: number;
}) {
  const [contentHeight, setContentHeight] = useState(0);
  const height = useSharedValue(0);
  useEffect(() => {
    height.value = withTiming(open ? contentHeight : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [open, contentHeight, height]);
  const panelStyle = useAnimatedStyle(() => ({ height: height.value }));
  function feedback() {
    if (process.env.EXPO_OS !== 'android' && process.env.EXPO_OS !== 'ios') return;
    const effect =
      process.env.EXPO_OS === 'android'
        ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Keyboard_Tap)
        : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void effect.catch(() => {});
  }
  return (
    <Animated.View
      style={[{ overflow: 'hidden' }, panelStyle]}
      pointerEvents={open ? 'auto' : 'none'}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
    >
      <View
        onLayout={({ nativeEvent }) => {
          // Native pixel rounding can alternate fractional measurements during animation.
          setContentHeight(Math.round(nativeEvent.layout.height));
        }}
        style={{ position: 'absolute', top: 0, width: '100%', backgroundColor: c.surface }}
      >
        <View
          accessibilityLabel="Amount keypad"
          style={{
            backgroundColor: c.surface,
            borderTopWidth: 1,
            borderColor: c.line,
            padding: 8,
            gap: 6,
          }}
        >
          {!!error && (
            <Text accessibilityRole="alert" style={{ color: c.warning, paddingHorizontal: 8 }}>
              {error}
            </Text>
          )}
          {rows.map((row, index) => (
            <View key={index} style={{ flexDirection: 'row', gap: 6 }}>
              {row.map((key) =>
                key === 'Done' ? (
                  <DoneKey key={key} onFeedback={feedback} onDone={onDone} />
                ) : key === '⌫' ? (
                  <BackspaceKey key={key} onFeedback={feedback} onKey={onKey} enabled={open} />
                ) : (
                  <Key key={key} label={key} onFeedback={feedback} onKey={onKey} />
                ),
              )}
            </View>
          ))}
        </View>
        <View
          style={{
            paddingHorizontal: 36,
            height: Math.max(52, bottomInset + 24),
            justifyContent: 'center',
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hide amount keypad"
            onPress={onDone}
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.control,
              backgroundColor: pressed ? c.line : 'transparent',
            })}
          >
            <SymbolView
              name={{ ios: 'chevron.down', android: 'expand_more' }}
              size={20}
              tintColor={c.text}
            />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const keyStyle = {
  minHeight: 48,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
} as const;

function Key({
  label,
  onFeedback,
  onKey,
}: {
  label: string;
  onFeedback: () => void;
  onKey: (key: string) => void;
}) {
  return <KeyButton label={label} onPressIn={onFeedback} onPress={() => onKey(label)} />;
}

function BackspaceKey({
  enabled,
  onFeedback,
  onKey,
}: {
  enabled: boolean;
  onFeedback: () => void;
  onKey: (key: string) => void;
}) {
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const repeated = useRef(false);
  const latestOnKey = useRef(onKey);
  useEffect(() => {
    latestOnKey.current = onKey;
  }, [onKey]);
  function stopRepeating() {
    if (repeatTimer.current !== null) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }
  useEffect(() => {
    if (!enabled) stopRepeating();
    return stopRepeating;
  }, [enabled]);
  return (
    <KeyButton
      label="⌫"
      onPressIn={() => {
        repeated.current = false;
        onFeedback();
      }}
      onLongPress={() => {
        repeated.current = true;
        latestOnKey.current('⌫');
        repeatTimer.current = setInterval(() => latestOnKey.current('⌫'), 75);
      }}
      onPressOut={stopRepeating}
      onPress={() => {
        if (!repeated.current) onKey('⌫');
      }}
    />
  );
}

// Nonexclusive native keys allow overlapping presses from different fingers.
function KeyButton({
  label,
  ...handlers
}: { label: string } & Pick<
  ComponentProps<typeof Touchable>,
  'onPress' | 'onPressIn' | 'onPressOut' | 'onLongPress'
>) {
  const digit = /^[0-9.]$/.test(label);
  return (
    <Touchable
      accessible
      accessibilityRole="button"
      accessibilityLabel={labels[label] ?? label}
      exclusive={false}
      underlayColor={c.line}
      activeUnderlayOpacity={1}
      animationDuration={0}
      {...handlers}
      style={[keyStyle, { flex: 1, backgroundColor: digit ? c.raised : c.root }]}
    >
      <Text
        style={{
          color: digit ? c.text : c.accent,
          fontSize: 24,
          fontWeight: '500',
          fontVariant: ['tabular-nums'],
        }}
      >
        {label}
      </Text>
    </Touchable>
  );
}

function DoneKey({ onFeedback, onDone }: { onFeedback: () => void; onDone: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Done"
      onPressIn={onFeedback}
      onPress={onDone}
      style={({ pressed }) => [
        keyStyle,
        { flex: 2, backgroundColor: pressed ? c.line : c.selected },
      ]}
    >
      <Text style={{ color: c.text, fontSize: 17, fontWeight: '500' }}>Done</Text>
    </Pressable>
  );
}
