import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import NativeDatePicker from '@expo/ui/community/datetime-picker';
import { FormInput } from '@/components/form-controls';
import { parsePositiveAmountMinor } from '@/lib/amount';
import { dateFromEpochDay, epochDay } from '@/lib/database';
import { saveLendingEntry } from '@/lib/lending';
import { formatLineItemAmount } from '@/lib/line-item-amount';
import { formatActivityDay, formatBalance } from '@/lib/transaction-format';
import { LendingButton, colors, spacedRow, writeWithOverpaidCreditCheck } from './view.tsx';

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
        const saved = await writeWithOverpaidCreditCheck(
          (confirmOverpayment) => saveLendingEntry({ ...draft, confirmOverpayment }),
          'Write off anyway',
        );
        if (!saved) return;
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
          ...spacedRow,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: colors.line,
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
        <Text style={{ color: colors.muted }}>Amount</Text>
      </View>
      {id === undefined && minor === initialAmount && (
        <Text style={{ color: colors.muted, fontSize: 12 }}>This closes the balance</Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Date, ${formatActivityDay(day)}`}
        disabled={locked}
        onPress={() => setDatePicker(!datePicker)}
        style={{
          ...spacedRow,
          alignItems: 'center',
          minHeight: 48,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 12,
          paddingHorizontal: 14,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 16 }}>{formatActivityDay(day)}</Text>
        <Text style={{ color: colors.muted }}>Date</Text>
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
        <Text accessibilityRole="alert" style={{ color: colors.warning }}>
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
