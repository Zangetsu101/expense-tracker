import { useCallback, useEffect, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { ScrollView, Text, View } from 'react-native';
import { QueryBoundary } from '@/components/query-error-boundary';
import { Skeleton } from '@/components/loading';
import { FormButton, FormInput } from '@/components/form-controls';
import { QuickAddDate } from '@/components/quick-add-date';
import { AccountChoices } from '@/components/entry-choices';
import { TransferAmountInput } from '@/components/transfer-amount-input';
import { TransferBillChoices } from '@/features/quick-add/transfer-bill-choices';
import { accountsQuery } from '@/lib/account-queries';
import { theme } from '@/theme';

export type TransferDraft = {
  amountMinor: number;
  receivedAmountMinor?: number;
  fromAccountId: number;
  toAccountId: number;
  note: string;
  date: Date;
};
type Props = {
  initial: {
    fromId: number;
    toId: number;
    amountMinor: number;
    receivedAmountMinor?: number | null;
    note: string;
    date: Date;
  };
  fieldsLocked: boolean;
  deleting: boolean;
  submitLabel: string;
  onSubmit: (draft: TransferDraft) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onDelete: () => void;
};
const c = theme.colors;
function ReadyForm({
  initial,
  fieldsLocked,
  deleting,
  submitLabel,
  onSubmit,
  onDirtyChange,
  onCancel,
  onDelete,
}: Props) {
  const {
    data: accounts,
    error: refreshError,
    isFetching,
    refetch,
  } = useSuspenseQuery(accountsQuery());
  const [fromId, setFromId] = useState(initial.fromId);
  const [toId, setToId] = useState<number | undefined>(initial.toId);
  const [paid, setPaid] = useState<number | undefined>(initial.amountMinor);
  const [received, setReceived] = useState<number | undefined>(
    initial.receivedAmountMinor ?? undefined,
  );
  const [note, setNote] = useState(initial.note);
  const [date, setDate] = useState(initial.date);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [preset, setPreset] = useState<number>();
  const [presetRevision, setPresetRevision] = useState(0);
  const source = accounts.find((a) => a.id === fromId);
  const destination = accounts.find((a) => a.id === toId);
  const cross = source?.currencyCode !== destination?.currencyCode;
  const locked = fieldsLocked || pending;
  const amounts = useCallback((pay: number | undefined, receive: number | undefined) => {
    setPaid(pay);
    setReceived(receive);
  }, []);
  useEffect(() => {
    onDirtyChange(
      fromId !== initial.fromId ||
        toId !== initial.toId ||
        paid !== initial.amountMinor ||
        (received ?? null) !== (initial.receivedAmountMinor ?? null) ||
        note !== initial.note ||
        date.getTime() !== initial.date.getTime(),
    );
  }, [fromId, toId, paid, received, note, date, initial, onDirtyChange]);
  async function save() {
    if (pending || !paid || !source || !destination) return;
    setPending(true);
    setError('');
    try {
      await onSubmit({
        amountMinor: paid,
        receivedAmountMinor: received,
        fromAccountId: source.id,
        toAccountId: destination.id,
        note,
        date,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <TransferAmountInput
      editingTransfer
      source={source}
      destination={destination}
      initialPaid={initial.amountMinor}
      initialReceived={initial.receivedAmountMinor ?? undefined}
      disabled={locked}
      receivedPreset={preset}
      presetRevision={presetRevision}
      onChange={amounts}
    >
      {({ input, keypad, dismiss, editing }) => (
        <View style={{ flex: 1 }}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={dismiss}
            contentContainerStyle={{ padding: 22, gap: 18, paddingBottom: 48 }}
          >
            {input}
            {!!refreshError && (
              <FormButton
                label="Could not refresh accounts. Retry"
                onPress={() => void refetch()}
              />
            )}
            <View onTouchStart={dismiss} style={{ gap: 18 }}>
              <View accessibilityLabel="Source account" style={{ gap: 10 }}>
                <Text style={{ color: c.muted }}>From {source?.name}</Text>
                <AccountChoices
                  accounts={accounts}
                  selectedId={fromId}
                  disabled={locked}
                  onSelect={(id) => {
                    setFromId(id);
                    if (id === toId) setToId(undefined);
                  }}
                />
              </View>
              <View accessibilityLabel="Transfer destination" style={{ gap: 10 }}>
                <Text style={{ color: c.muted }}>To {destination?.name ?? 'another account'}</Text>
                <AccountChoices
                  accounts={accounts.filter((a) => a.id !== fromId)}
                  selectedId={toId}
                  disabled={locked}
                  onSelect={setToId}
                />
                <TransferBillChoices
                  destination={destination}
                  disabled={locked}
                  onPreset={(amount) => {
                    setPreset(amount);
                    setPresetRevision((revision) => revision + 1);
                  }}
                />
              </View>
              <QuickAddDate value={date} onChange={setDate} disabled={locked} />
              <FormInput
                accessibilityLabel="Note"
                value={note}
                onChangeText={setNote}
                editable={!locked}
                placeholder="Note (optional)"
              />
              {!!error && (
                <Text accessibilityRole="alert" style={{ color: c.warning }}>
                  {error}
                </Text>
              )}
              <FormButton
                label={submitLabel}
                loading={pending}
                disabled={
                  editing ||
                  deleting ||
                  isFetching ||
                  !paid ||
                  !source ||
                  !destination ||
                  (cross && !received)
                }
                onPress={() => void save()}
              />
              <FormButton label="Cancel" variant="secondary" disabled={locked} onPress={onCancel} />
              <FormButton
                label="Delete transfer"
                variant="danger"
                disabled={locked}
                onPress={onDelete}
              />
            </View>
          </ScrollView>
          {keypad}
        </View>
      )}
    </TransferAmountInput>
  );
}
function AccountPillsSkeleton({ label }: { label: string }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.muted }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 1, 2].map((column) => (
          <View key={column} style={{ flex: 1 }}>
            <Skeleton width="100%" height={48} borderRadius={14} />
          </View>
        ))}
      </View>
    </View>
  );
}
function TransferFormSkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading accounts"
      style={{ padding: 22, gap: 18 }}
    >
      <Skeleton width="55%" height={44} />
      <AccountPillsSkeleton label="From" />
      <AccountPillsSkeleton label="To" />
      <Skeleton width="100%" height={theme.controlHeight} borderRadius={theme.radius.control} />
      <Skeleton width="100%" height={theme.controlHeight} borderRadius={theme.radius.control} />
    </View>
  );
}
export function TransferFormSection(props: Props) {
  return (
    <QueryBoundary
      pending={<TransferFormSkeleton />}
      error={(retry) => (
        <View style={{ padding: 22 }}>
          <FormButton label="Could not load accounts. Retry" onPress={retry} />
        </View>
      )}
    >
      <ReadyForm {...props} />
    </QueryBoundary>
  );
}
