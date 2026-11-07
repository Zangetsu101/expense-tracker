import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calculateAmount } from '@/lib/amount-calculator';
import { parsePositiveAmountMinor } from '@/lib/amount';
import { AmountCalculator } from './amount-calculator.tsx';
import { theme } from '@/theme';

const c = theme.colors;

export function AmountInput({
  currency,
  disabled: pending = false,
  onChange,
  children,
}: {
  currency?: string;
  disabled?: boolean;
  onChange: (amountMinor: number | undefined) => void;
  children: (slots: {
    input: ReactNode;
    keypad: ReactNode;
    dismiss: () => void;
    editing: boolean;
  }) => ReactNode;
}) {
  const [amount, setAmount] = useState('');
  const [calculatorOpen, setCalculatorOpen] = useState(true);
  const [validAmount, setValidAmount] = useState(false);
  const insets = useSafeAreaInsets();
  function dismiss() {
    if (!calculatorOpen) return;
    try {
      const calculated = calculateAmount(amount);
      const minor = parsePositiveAmountMinor(calculated);
      setAmount(calculated);
      setValidAmount(true);
      onChange(minor);
    } catch {
      setValidAmount(false);
      onChange(undefined);
    }
    setCalculatorOpen(false);
  }
  const onHardwareBack = useEffectEvent(() => {
    dismiss();
    return true;
  });
  useEffect(() => {
    if (!calculatorOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => subscription.remove();
  }, [calculatorOpen]);
  const input = (
    <View style={{ gap: 6 }}>
      <Text
        style={{ color: c.muted, fontSize: 12 }}
      >{`Amount · ${currency ?? 'Select account'}`}</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: 1,
          borderColor: c.line,
        }}
      >
        <Text style={{ color: c.text, fontSize: 48, fontWeight: '300' }}>
          {currency === 'BDT' ? '৳' : currency === 'USD' ? '$' : ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Amount"
          accessibilityValue={{ text: amount || '0.00' }}
          accessibilityHint="Opens the amount calculator"
          accessibilityState={{ disabled: pending }}
          disabled={pending}
          onPress={() => {
            Keyboard.dismiss();
            setCalculatorOpen(true);
          }}
          style={{ flex: 1, minHeight: 64, justifyContent: 'center' }}
        >
          <Text
            style={{
              color: amount ? c.text : c.muted,
              fontSize: 48,
              fontWeight: '300',
              fontVariant: ['tabular-nums'],
            }}
          >
            {amount || '0.00'}
          </Text>
        </Pressable>
      </View>
      {!calculatorOpen && !!amount && !validAmount && (
        <Text accessibilityRole="alert" style={{ color: c.warning }}>
          Enter a positive amount with at most two decimal places.
        </Text>
      )}
    </View>
  );
  const keypad = (
    <AmountCalculator
      open={calculatorOpen}
      bottomInset={insets.bottom}
      value={amount}
      onChange={setAmount}
      onDone={dismiss}
    />
  );
  return children({ input, keypad, dismiss, editing: calculatorOpen });
}
