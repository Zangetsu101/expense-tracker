import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import NativeDatePicker from '@expo/ui/community/datetime-picker';
import { FormInput } from '@/components/form-controls';
import { parsePositiveAmountMinor } from '@/lib/amount';
import { dateFromEpochDay, epochDay } from '@/lib/database';
import { saveLendingEntry } from '@/lib/lending';
import { formatLineItemAmount } from '@/lib/line-item-amount';
import { formatActivityDay, formatBalance } from '@/lib/transaction-format';
import { LendingButton, askOverpayment, c, two } from './view.tsx';

export function WriteOffForm({
  id,
  personId,
  kind,
  currency,
  initialAmount,
  initialDate,
  initialNote = '',
  disabled,
  onSavingChange,
  onDirtyChange,
  onSaved,
  children,
}: {
  id?: number;
  personId: number;
  kind: 'WRITE_OFF_LENT' | 'WRITE_OFF_BORROWED';
  currency: string;
  initialAmount: number;
  initialDate?: number;
  initialNote?: string;
  disabled?: boolean;
  onSavingChange: (value: boolean) => void;
  onDirtyChange?: (value: boolean) => void;
  onSaved: () => void | Promise<void>;
  children?: ReactNode;
}) {
  const [amount, setAmount] = useState(() => formatLineItemAmount(initialAmount));
  const [date, setDate] = useState(() =>
    initialDate === undefined ? new Date() : dateFromEpochDay(initialDate),
  );
  const [datePicker, setDatePicker] = useState(false);
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [committed, setCommitted] = useState(false);
  const saving = useRef(false);
  let minor: number | undefined;
  try {
    minor = parsePositiveAmountMinor(amount);
  } catch {
    minor = undefined;
  }
  const day = epochDay(date);
  const locked = pending || committed || disabled;
  useEffect(() => {
    onDirtyChange?.(
      !committed && (minor !== initialAmount || day !== initialDate || note !== initialNote),
    );
  }, [committed, day, initialAmount, initialDate, initialNote, minor, note, onDirtyChange]);

  async function submit(amountMinor: number) {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    onSavingChange(true);
    setError('');
    try {
      if (!committed) {
        const draft = { id, personId, kind, currencyCode: currency, amountMinor, date: day, note };
        const result = await saveLendingEntry(draft);
        if (result.status === 'confirmation_required') {
          if (!(await askOverpayment(result.warnings, 'Write off anyway'))) return;
          await saveLendingEntry({ ...draft, confirmOverpayment: true });
        }
        setCommitted(true);
      }
      await onSaved();
    } catch (cause) {
      setError(String(cause));
    } finally {
      saving.current = false;
      setPending(false);
      onSavingChange(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          ...two,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: 12,
          paddingRight: 14,
        }}
      >
        <FormInput
          accessibilityLabel="Amount"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          editable={!locked}
          style={{
            flex: 1,
            borderWidth: 0,
            fontVariant: ['tabular-nums'],
            fontSize: 22,
            fontWeight: '700',
          }}
        />
        <Text style={{ color: c.muted }}>Amount</Text>
      </View>
      {id === undefined && minor === initialAmount && (
        <Text style={{ color: c.muted, fontSize: 12 }}>This closes the balance</Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Date, ${formatActivityDay(day)}`}
        disabled={locked}
        onPress={() => setDatePicker(!datePicker)}
        style={{
          ...two,
          alignItems: 'center',
          minHeight: 48,
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: 12,
          paddingHorizontal: 14,
        }}
      >
        <Text style={{ color: c.text, fontSize: 16 }}>{formatActivityDay(day)}</Text>
        <Text style={{ color: c.muted }}>Date</Text>
      </Pressable>
      {datePicker && !locked && (
        <NativeDatePicker
          value={date}
          mode="date"
          maximumDate={new Date()}
          display={process.env.EXPO_OS === 'ios' ? 'inline' : 'default'}
          presentation={process.env.EXPO_OS === 'android' ? 'dialog' : 'inline'}
          onValueChange={(_, value) => {
            setDate(value);
            setDatePicker(false);
          }}
          onDismiss={() => setDatePicker(false)}
          {...(process.env.EXPO_OS === 'ios' ? { themeVariant: 'dark' as const } : {})}
        />
      )}

      <FormInput
        accessibilityLabel="Note"
        placeholder="Optional note"
        value={note}
        onChangeText={setNote}
        editable={!locked}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: c.warning }}>
          {error}
        </Text>
      )}
      <LendingButton
        label={
          committed
            ? 'Retry receipt'
            : id
              ? 'Save changes'
              : minor
                ? `Write off ${formatBalance(minor, currency)}`
                : 'Write off'
        }
        disabled={disabled || !minor || (id === undefined && minor > initialAmount)}
        pending={pending}
        onPress={() => {
          if (minor) void submit(minor);
        }}
      />
      {!locked && children}
    </View>
  );
}
