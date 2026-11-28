import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import type { Account } from '@/lib/database';
import {
  applyTransferAmount,
  formatTransferRate,
  type TransferAmounts,
  type TransferField,
} from '@/lib/transfer-amounts';
import { loadFirstTransferRate } from '@/lib/transfer-rate-store';
import { calculateAmount, pressAmountKey, type AmountEntry } from '@/lib/amount-calculator';
import { formatLineItemAmount } from '@/lib/line-item-amount';
import { currencySymbol } from '@/lib/currency';
import { AmountCalculator } from './amount-calculator.tsx';
import { theme } from '@/theme';

const c = theme.colors;
type AmountContext = {
  source?: number;
  destination?: number;
  cross: boolean;
  rate?: Awaited<ReturnType<typeof loadFirstTransferRate>>;
};
type AmountSlots = {
  input: ReactNode;
  keypad: ReactNode;
  dismiss: () => void;
  editing: boolean;
  applyReceivedPreset: (amount: number) => void;
};

/** Return the saved rate as the amount of the other currency for one unit of `base`. */
function rateForBase(saved: { base: string; rate?: number } | null | undefined, base: string) {
  if (saved?.rate === undefined) return undefined;
  return saved.base === base ? saved.rate : 1 / saved.rate;
}

function savedEntryAmount(field: TransferField, value: number | undefined) {
  if (value === undefined) return '';
  return field === 'rate' ? formatTransferRate(value) : formatLineItemAmount(value);
}

export function TransferAmountInput({
  source,
  destination,
  initialPaid,
  initialReceived,
  editingTransfer = false,
  disabled = false,
  initialKeypadDelay = 0,
  onChange,
  children,
}: {
  source?: Account;
  destination?: Account;
  initialPaid?: number;
  initialReceived?: number;
  editingTransfer?: boolean;
  disabled?: boolean;
  initialKeypadDelay?: number;
  onChange: (paid: number | undefined, received: number | undefined) => void;
  children: (slots: AmountSlots) => ReactNode;
}) {
  const cross = !!source && !!destination && source.currencyCode !== destination.currencyCode;
  const rateSession = useId();
  const rateRead = useQuery({
    queryKey: ['transfer-rate', rateSession, source?.currencyCode, destination?.currencyCode],
    queryFn: () => loadFirstTransferRate(source!.currencyCode, destination!.currencyCode),
    enabled: cross,
    staleTime: Infinity,
  });
  const [directions, setDirections] = useState<Record<string, { base: string; quote: string }>>({});
  const [state, setState] = useState<TransferAmounts>(() => ({
    pay: initialPaid,
    receive: initialReceived,
    base: destination?.currencyCode ?? '',
    quote: source?.currencyCode ?? '',
    typed: {
      pay: !!initialPaid,
      receive: !!initialReceived,
    },
  }));
  const [context, setContext] = useState<AmountContext>({
    cross: false,
  });
  const [keypadDelay, setKeypadDelay] = useState(initialKeypadDelay);
  const [focus, setFocus] = useState<TransferField | null>(
    initialPaid || initialReceived ? null : 'pay',
  );
  const [entry, setEntry] = useState<AmountEntry>({ amount: '', evaluated: false, error: '' });
  // Rapid keys can arrive before a render. Each key reads the entry that the key before it made.
  const latestEntry = useRef(entry);
  const buffer = entry.amount;
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();
  if (
    context.source !== source?.id ||
    context.destination !== destination?.id ||
    context.cross !== cross ||
    (context.rate === undefined && rateRead.data !== undefined)
  ) {
    const destinationChanged =
      context.destination !== undefined && context.destination !== destination?.id;
    let next = { ...state, typed: { ...state.typed } };
    if (destinationChanged) {
      next.receive = undefined;
      next.typed.receive = false;
    }
    if (cross) {
      const paidWasTyped = next.typed.pay;
      const first = rateRead.data;
      const key = [source!.currencyCode, destination!.currencyCode].sort().join('/');
      const direction = directions[key] ??
        first ?? { base: destination!.currencyCode, quote: source!.currencyCode };
      if (first && !directions[key])
        setDirections({ ...directions, [key]: { base: direction.base, quote: direction.quote } });
      const pairChanged =
        ![next.base, next.quote].includes(source!.currencyCode) ||
        ![next.base, next.quote].includes(destination!.currencyCode);
      next.base = direction.base;
      next.quote = direction.quote;
      if (destinationChanged || pairChanged || (context.rate === undefined && first !== undefined))
        next.rate = rateForBase(first, direction.base);
      if (next.typed.receive) {
        if (context.source !== undefined && context.source !== source?.id) {
          next.pay = undefined;
          next.typed.pay = false;
        }
        next = applyTransferAmount(next, 'receive', next.receive, source!.currencyCode);
      } else next = applyTransferAmount(next, 'pay', next.pay, source!.currencyCode);
      next.typed.pay = paidWasTyped;
    } else if (destination) {
      if (next.typed.receive && next.receive) next.pay = next.receive;
      next.receive = undefined;
      next.typed.receive = false;
    }
    setState(next);
    setContext({
      source: source?.id,
      destination: destination?.id,
      cross,
      rate: rateRead.data,
    });
    if (
      context.source !== undefined ||
      context.destination !== undefined ||
      initialPaid ||
      initialReceived ||
      cross
    )
      setFocus(null);
    setEntry({ amount: '', evaluated: false, error: '' });
  }
  const ready = !cross || !!rateRead.data;
  useEffect(() => {
    onChange(ready ? state.pay : undefined, cross ? state.receive : undefined);
  }, [state, ready, cross, onChange]);
  function apply(field: TransferField, value: number | undefined) {
    setState((previous) =>
      cross
        ? applyTransferAmount(previous, field, value, source!.currencyCode)
        : { ...previous, pay: value, typed: { pay: value !== undefined, receive: false } },
    );
  }
  function applyReceivedPreset(value: number) {
    if (cross) apply('receive', value);
    else setState((previous) => ({ ...previous, pay: value }));
    setEntry({ amount: '', evaluated: false, error: '' });
    setFocus(null);
    setChanged(false);
    setError('');
  }
  function change(value: string) {
    if (!value) {
      if (focus !== 'rate') apply(focus!, undefined);
      return;
    }
    if (/^(\d+\.?\d*|\.\d+)$/.test(value)) {
      const number = Number(value);
      const amount = focus === 'rate' ? number : Math.round(number * 100);
      apply(focus!, number > 0 && Number.isSafeInteger(Math.round(amount)) ? amount : undefined);
    } else apply(focus!, undefined);
  }
  function dismiss() {
    if (!focus) return;
    if (!changed) {
      setFocus(null);
      return;
    }
    try {
      const number = Number(calculateAmount(buffer, focus === 'rate' ? 4 : 2));
      if (number <= 0) throw new Error('Enter a positive value.');
      apply(focus, focus === 'rate' ? number : Math.round(number * 100));
      setError('');
    } catch {
      if (buffer) setError('Enter a complete positive calculation.');
    }
    setFocus(null);
  }
  const back = useEffectEvent(() => {
    dismiss();
    return true;
  });
  useEffect(() => {
    if (!focus) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', back);
    return () => subscription.remove();
  }, [focus]);
  function select(field: TransferField) {
    setKeypadDelay(0);
    if (focus) dismiss();
    Keyboard.dismiss();
    const value = state[field];
    // The first digit replaces the saved value, as after the equals key.
    latestEntry.current = {
      amount: savedEntryAmount(field, value),
      evaluated: true,
      error: '',
    };
    setEntry(latestEntry.current);
    setFocus(field);
    setChanged(false);
  }
  const historicalRate = rateForBase(context.rate, state.base);
  const showHistoricalDate =
    !editingTransfer &&
    focus !== 'rate' &&
    historicalRate !== undefined &&
    state.rate !== undefined &&
    Math.abs(state.rate - historicalRate) < 0.00005;
  let rateText = state.rate ? formatTransferRate(state.rate) : '—';
  if (focus === 'rate') rateText = buffer || '—';
  const input = (
    <View style={{ gap: 10 }}>
      {cross && (
        <TransferAmountField
          label={`${destination!.name} receives`}
          currency={destination!.currencyCode}
          value={state.receive}
          buffer={buffer}
          focused={focus === 'receive'}
          disabled={disabled || !ready}
          onPress={() => select('receive')}
        />
      )}

      {cross && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          <Text style={{ color: c.muted }}>{`1 ${state.base} =`}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rate"
            disabled={disabled || !ready}
            onPress={() => select('rate')}
            style={{
              minHeight: 44,
              minWidth: 56,
              justifyContent: 'center',
              borderBottomWidth: 1,
              borderColor: focus === 'rate' ? c.accent : c.line,
            }}
          >
            <Text style={{ color: c.text, textAlign: 'center' }}>{rateText}</Text>
          </Pressable>
          <Text style={{ color: c.muted }}>{state.quote}</Text>
          {showHistoricalDate &&
            context.rate &&
            'date' in context.rate &&
            context.rate.date !== undefined && (
              <Text
                style={{ color: c.muted }}
              >{`(from ${new Date(context.rate.date * 86400000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })})`}</Text>
            )}
        </View>
      )}
      <TransferAmountField
        label={
          cross ? `${source!.name} pays` : `Amount · ${source?.currencyCode ?? 'Select account'}`
        }
        accessibilityLabel={cross ? `${source!.name} pays` : 'Amount'}
        currency={source?.currencyCode ?? ''}
        value={state.pay}
        buffer={buffer}
        focused={focus === 'pay'}
        disabled={disabled || !ready}
        onPress={() => select('pay')}
      />
      {cross && rateRead.isPending && <Text style={{ color: c.muted }}>Loading rate…</Text>}
      {cross && rateRead.isError && (
        <Pressable accessibilityRole="button" onPress={() => void rateRead.refetch()}>
          <Text style={{ color: c.warning }}>Could not load rate. Retry</Text>
        </Pressable>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: c.warning }}>
          {error}
        </Text>
      )}
    </View>
  );
  return children({
    input,
    applyReceivedPreset,
    editing: focus !== null,
    dismiss,
    keypad: (
      <AmountCalculator
        key={focus ?? 'closed'}
        error={entry.error}
        onKey={(key) => {
          const next = pressAmountKey(latestEntry.current, key, focus === 'rate' ? 4 : 2);
          latestEntry.current = next;
          setEntry(next);
          setChanged(true);
          setError('');
          change(next.amount);
        }}
        onDone={dismiss}
        open={focus !== null && !disabled && ready}
        initialDelay={keypadDelay}
        bottomInset={insets.bottom}
      />
    ),
  });
}

function TransferAmountField({
  label,
  accessibilityLabel = label,
  currency,
  value,
  buffer,
  focused,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  currency: string;
  value?: number;
  buffer: string;
  focused: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const amountText = value === undefined ? '0.00' : formatLineItemAmount(value);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: amountText }}
        disabled={disabled}
        onPress={onPress}
        style={{
          minHeight: 64,
          borderBottomWidth: 1,
          borderColor: focused ? c.accent : c.line,
          justifyContent: 'center',
        }}
      >
        <Text
          style={{ color: c.text, fontSize: 48, fontWeight: '300', fontVariant: ['tabular-nums'] }}
        >
          {currencySymbol(currency)}
          {focused ? buffer || '0.00' : amountText}
        </Text>
      </Pressable>
    </View>
  );
}
