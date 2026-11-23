import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calculateAmount, pressAmountKey } from '@/lib/amount-calculator';
import { parsePositiveAmountMinor } from '@/lib/amount';
import { AmountCalculator } from './amount-calculator.tsx';
import { theme } from '@/theme';

const c = theme.colors;
function amountSymbol(currency: string | undefined) {
  if (currency === 'BDT') return '৳';
  if (currency === 'USD') return '$';
  return '';
}

type AmountInputSlots = {
  input: ReactNode;
  keypad: ReactNode;
  dismiss: () => void;
  editing: boolean;
};

export function useAmountInputDraft(initialAmount = '', initiallyOpen = true) {
  const [entry, setEntry] = useState({ amount: initialAmount, evaluated: false, error: '' });
  const [calculatorOpen, setCalculatorOpen] = useState(initiallyOpen);
  const [validAmount, setValidAmount] = useState(!!initialAmount);
  return {
    entry,
    setEntry,
    calculatorOpen,
    setCalculatorOpen,
    validAmount,
    setValidAmount,
    reset(amount: string, open: boolean) {
      setEntry({ amount, evaluated: false, error: '' });
      setCalculatorOpen(open);
      setValidAmount(!!amount);
    },
  };
}

type Props = {
  currency?: string;
  disabled?: boolean;
  onChange: (amountMinor: number | undefined) => void;
  children: (slots: AmountInputSlots) => ReactNode;
};

export function AmountInput({
  initialAmount,
  initiallyOpen,
  ...props
}: Props & {
  initialAmount?: string;
  initiallyOpen?: boolean;
}) {
  const draft = useAmountInputDraft(initialAmount, initiallyOpen);
  return <ControlledAmountInput {...props} draft={draft} />;
}

export function ControlledAmountInput({
  currency,
  draft,
  disabled: pending = false,
  onChange,
  children,
}: Props & { draft: ReturnType<typeof useAmountInputDraft> }) {
  const { entry, setEntry, calculatorOpen, setCalculatorOpen, validAmount, setValidAmount } = draft;
  const { amount } = entry;
  const insets = useSafeAreaInsets();
  function dismiss() {
    if (!calculatorOpen) return;
    try {
      const calculated = calculateAmount(amount);
      const minor = parsePositiveAmountMinor(calculated);
      setEntry({ amount: calculated, evaluated: false, error: '' });
      setValidAmount(true);
      onChange(minor);
    } catch {
      setEntry((current) => ({ ...current, evaluated: false, error: '' }));
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
          {amountSymbol(currency)}
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
      error={entry.error}
      onKey={(key) => setEntry((current) => pressAmountKey(current, key))}
      onDone={dismiss}
    />
  );
  return children({ input, keypad, dismiss, editing: calculatorOpen });
}
