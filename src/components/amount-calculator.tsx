import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { calculateAmount } from '@/lib/amount-calculator';
import { theme } from '@/theme';

const rows = [['C', '÷', '×', '⌫'], ['7', '8', '9', '−'], ['4', '5', '6', '+'], ['1', '2', '3', '='], ['.', '0', 'Done']];
const labels: Record<string, string> = { C: 'Clear calculation', '⌫': 'Backspace', '÷': 'Divide', '×': 'Multiply', '−': 'Subtract', '+': 'Add', '=': 'Equals', Done: 'Done' };
const c = theme.colors;

export function AmountCalculator({ value, onChange, onDone, open, bottomInset }: {
  value: string; onChange: (amount: string) => void; onDone: () => void; open: boolean; bottomInset: number;
}) {
  const [error, setError] = useState('');
  const [evaluated, setEvaluated] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setError('');
    setEvaluated(false);
  }
  const [contentHeight, setContentHeight] = useState(0);
  const height = useSharedValue(0);
  useEffect(() => {
    height.value = withTiming(open ? contentHeight : 0, {
      duration: 220, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System,
    });
  }, [open, contentHeight, height]);
  const panelStyle = useAnimatedStyle(() => ({ height: height.value }));
  function feedback() {
    if (process.env.EXPO_OS !== 'android' && process.env.EXPO_OS !== 'ios') return;
    const effect = process.env.EXPO_OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Keyboard_Tap)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void effect.catch(() => {});
  }
  function press(key: string) {
    setError('');
    if (key === 'Done') { onDone(); return; }
    if (key === '=') {
      try { onChange(calculateAmount(value)); setEvaluated(true); }
      catch (cause) { setError((cause as Error).message); }
      return;
    }
    let next = key === 'C' ? '' : key === '⌫' ? value.slice(0, -1) : evaluated && /^[0-9.]$/.test(key) ? key : value + key;
    if (['+', '−', '×', '÷'].includes(key) && /[+−×÷]$/.test(value)) next = value.slice(0, -1) + key;
    onChange(next);
    setEvaluated(false);
  }
  return <Animated.View style={[{ overflow: 'hidden' }, panelStyle]} pointerEvents={open ? 'auto' : 'none'}
    accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}>
    <View onLayout={({ nativeEvent }) => setContentHeight(nativeEvent.layout.height)}
      style={{ position: 'absolute', top: 0, width: '100%', backgroundColor: c.surface }}>
      <View accessibilityLabel="Amount keypad" style={{ backgroundColor: c.surface, borderTopWidth: 1, borderColor: c.line, padding: 8, gap: 6 }}>
        {!!error && <Text accessibilityRole="alert" style={{ color: c.warning, paddingHorizontal: 8 }}>{error}</Text>}
        {rows.map((row, index) => <View key={index} style={{ flexDirection: 'row', gap: 6 }}>
          {row.map((key) => {
            const digit = /^[0-9.]$/.test(key);
            return <Pressable key={key} accessibilityRole="button" accessibilityLabel={labels[key] ?? key} onPressIn={feedback} onPress={() => press(key)} style={({ pressed }) => ({
              flex: key === 'Done' ? 2 : 1, minHeight: 48, alignItems: 'center', justifyContent: 'center',
              borderRadius: 6, backgroundColor: pressed ? c.line : key === 'Done' ? c.selected : digit ? c.raised : c.root,
            })}>
              <Text style={{ color: digit || key === 'Done' ? c.text : c.accent, fontSize: key === 'Done' ? 17 : 24, fontWeight: '500', fontVariant: ['tabular-nums'] }}>{key}</Text>
            </Pressable>;
          })}
        </View>)}
      </View>
      <View style={{ paddingHorizontal: 36, height: Math.max(52, bottomInset + 24), justifyContent: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Hide amount keypad" onPress={onDone}
          style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.control, backgroundColor: pressed ? c.line : 'transparent' })}>
          <SymbolView name={{ ios: 'chevron.down', android: 'expand_more' }} size={20} tintColor={c.text} />
        </Pressable>
      </View>
    </View>
  </Animated.View>;
}
