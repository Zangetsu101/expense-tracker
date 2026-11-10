import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Host, Switch } from '@expo/ui';
import { ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { AmountInput } from '@/components/amount-input';
import { FormButton, FormInput } from '@/components/form-controls';
import { Skeleton } from '@/components/loading';
import { formatEpochDay, formatTransactionAmount } from '@/lib/transaction-format';
import { formatLineItemAmount, parseLineItemAmount } from '@/lib/line-item-amount';
import {
  saveTransactionEdit,
  type EditableTransaction,
  type LineItem,
} from '@/lib/transaction-edit';
import { theme } from '@/theme';

export function EditTransactionScreen({
  transaction,
  deleting,
  onDirtyChange,
  onSavingChange,
  onCancel,
  onDelete,
  onSaved,
}: {
  transaction: EditableTransaction;
  deleting: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
  onCancel: () => void;
  onDelete: () => void;
  onSaved: () => Promise<void>;
}) {
  const initialAmount = formatLineItemAmount(transaction.amountMinor);
  const amountLocked = !!transaction.lendingKind;
  const [amountMinor, setAmountMinor] = useState<number | undefined>(transaction.amountMinor);
  const [note, setNote] = useState(transaction.note ?? '');
  const initialTags = transaction.tags.map((tag) => tag.name).join(', ');
  const initialItems = useMemo(
    () =>
      transaction.lineItems.map((item) => ({
        id: item.id,
        name: item.name,
        amount: formatLineItemAmount(item.amountMinor),
        quantity: item.quantity?.toString() ?? '',
      })),
    [transaction.lineItems],
  );
  const [tags, setTags] = useState(initialTags);
  const [excluded, setExcluded] = useState(
    !!transaction.reportExclusionLocked || transaction.excludeFromReport !== 0,
  );
  const [items, setItems] =
    useState<{ id?: number; name: string; amount: string; quantity: string }[]>(initialItems);
  const [saving, setSaving] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    onDirtyChange(
      !committed &&
        (amountMinor !== transaction.amountMinor ||
          note !== (transaction.note ?? '') ||
          tags !== initialTags ||
          excluded !== (transaction.excludeFromReport !== 0) ||
          JSON.stringify(items) !== JSON.stringify(initialItems)),
    );
  }, [
    amountMinor,
    note,
    tags,
    excluded,
    items,
    transaction,
    initialTags,
    initialItems,
    committed,
    onDirtyChange,
  ]);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    onSavingChange(true);
    setError(undefined);
    try {
      if (amountMinor === undefined)
        throw new Error('Enter a positive amount with at most two decimal places.');
      const lineItems: LineItem[] = items.map((item) => {
        const amountMinor = parseLineItemAmount(item.amount);
        const quantity = item.quantity.trim() === '' ? null : Number(item.quantity.trim());
        return { id: item.id, name: item.name, amountMinor, quantity };
      });
      if (!committed) {
        await saveTransactionEdit(transaction, note, excluded, tags, lineItems, amountMinor);
        setCommitted(true);
      }
      await onSaved();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  };
  const locked = saving || committed || deleting;
  const labelStyle = {
    color: theme.colors.text,
    fontSize: theme.type.body,
    fontWeight: '600' as const,
  };
  return (
    <AmountInput
      currency={transaction.currencyCode}
      initialAmount={initialAmount}
      initiallyOpen={false}
      disabled={locked}
      onChange={setAmountMinor}
    >
      {({ input, keypad, dismiss: dismissCalculator, editing: calculating }) => (
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={dismissCalculator}
            style={{ flex: 1, backgroundColor: theme.colors.background }}
            contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 20 }}
          >
            <>
              <View
                style={{
                  gap: 8,
                  padding: 16,
                  borderRadius: theme.radius.group,
                  backgroundColor: theme.colors.surface,
                }}
              >
                {amountLocked ? (
                  <Text
                    selectable
                    style={{
                      color: theme.colors.text,
                      fontSize: 24,
                      fontWeight: '600',
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {formatTransactionAmount(
                      transaction.type,
                      transaction.amountMinor,
                      transaction.currencyCode,
                    )}
                  </Text>
                ) : (
                  input
                )}
                <Text selectable style={{ color: theme.colors.text }}>
                  {transaction.categoryName ?? transaction.type} · {transaction.accountName}
                </Text>
                <Text selectable style={{ color: theme.colors.muted }}>
                  {formatEpochDay(transaction.date)} ·{' '}
                  {amountLocked
                    ? 'Change the amount of a lending entry from Lending'
                    : 'Category, Account and date are read-only'}
                </Text>
              </View>
              <View style={{ gap: 20 }} onTouchStart={dismissCalculator}>
                <View style={{ gap: 8 }}>
                  <Text style={labelStyle}>Note</Text>
                  <FormInput
                    accessibilityLabel="Note"
                    multiline
                    value={note}
                    onChangeText={setNote}
                    editable={!locked}
                    placeholder="Optional note"
                    style={{ minHeight: 100, textAlignVertical: 'top' }}
                  />
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={labelStyle}>Tags</Text>
                  <FormInput
                    accessibilityLabel="Tags"
                    value={tags}
                    onChangeText={setTags}
                    editable={!locked}
                    placeholder="Comma-separated tags"
                    autoCapitalize="words"
                  />
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={labelStyle}>
                    Line items{' '}
                    <Text style={{ color: theme.colors.muted, fontWeight: '400' }}>(optional)</Text>
                  </Text>
                  <Text selectable style={{ color: theme.colors.muted, lineHeight: 20 }}>
                    Line items do not change the Transaction amount and do not need to add up to it.
                    Amounts can be positive, negative or zero.
                  </Text>
                  {items.map((item, index) => (
                    <View
                      key={item.id ?? `new-${index}`}
                      style={{
                        gap: 10,
                        padding: 12,
                        backgroundColor: theme.colors.surface,
                        borderRadius: theme.radius.group,
                      }}
                    >
                      <Text style={{ color: theme.colors.muted }}>Line item {index + 1}</Text>
                      <FormInput
                        accessibilityLabel={`Line item ${index + 1} name`}
                        placeholder="Name"
                        value={item.name}
                        editable={!locked}
                        onChangeText={(name) =>
                          setItems((current) =>
                            current.map((entry, i) => (i === index ? { ...entry, name } : entry)),
                          )
                        }
                      />
                      <FormInput
                        accessibilityLabel={`Line item ${index + 1} amount`}
                        placeholder="Amount (major units)"
                        value={item.amount}
                        editable={!locked}
                        keyboardType="numbers-and-punctuation"
                        onChangeText={(amount) =>
                          setItems((current) =>
                            current.map((entry, i) => (i === index ? { ...entry, amount } : entry)),
                          )
                        }
                      />
                      <FormInput
                        accessibilityLabel={`Line item ${index + 1} quantity`}
                        placeholder="Quantity (optional)"
                        value={item.quantity}
                        editable={!locked}
                        keyboardType="decimal-pad"
                        onChangeText={(quantity) =>
                          setItems((current) =>
                            current.map((entry, i) =>
                              i === index ? { ...entry, quantity } : entry,
                            ),
                          )
                        }
                      />
                      <FormButton
                        label="Remove line item"
                        accessibilityLabel={`Remove line item ${index + 1}`}
                        variant="danger"
                        disabled={locked}
                        onPress={() => setItems((current) => current.filter((_, i) => i !== index))}
                      />
                    </View>
                  ))}
                  <FormButton
                    label="Add line item"
                    variant="secondary"
                    disabled={locked}
                    onPress={() =>
                      setItems((current) => [...current, { name: '', amount: '', quantity: '' }])
                    }
                  />
                </View>
                <Host colorScheme="dark" style={{ width: '100%', height: 56 }}>
                  <Switch
                    label="Exclude from reports"
                    value={excluded}
                    onValueChange={setExcluded}
                    disabled={locked || !!transaction.reportExclusionLocked}
                  />
                </Host>
                {!!transaction.reportExclusionLocked && (
                  <Text style={{ color: theme.colors.muted }}>
                    Principal movements are always excluded from reports.
                  </Text>
                )}
                {error && (
                  <Text
                    accessibilityRole="alert"
                    selectable
                    style={{ color: theme.colors.warning }}
                  >
                    {error}
                  </Text>
                )}
                <FormButton
                  label={saving ? 'Saving…' : committed ? 'Retry receipt' : 'Save changes'}
                  loading={saving}
                  disabled={deleting || calculating || amountMinor === undefined}
                  onPress={() => {
                    if (!calculating) void save();
                  }}
                />
                <FormButton
                  label="Cancel"
                  variant="secondary"
                  disabled={saving || deleting}
                  onPress={onCancel}
                />
                <FormButton
                  label={deleting ? 'Deleting…' : 'Delete transaction'}
                  variant="danger"
                  disabled={locked}
                  onPress={onDelete}
                />
              </View>
            </>
          </ScrollView>
          {!amountLocked && keypad}
        </View>
      )}
    </AmountInput>
  );
}

const c = theme.colors;

/** Header options for a screen that shows no receipt: no Edit and no Cancel. */
function ReceiptHeader() {
  return (
    <Stack.Screen
      options={{
        title: 'Receipt',
        headerStyle: { backgroundColor: c.background },
        headerTintColor: c.text,
        gestureEnabled: true,
        headerLeft: undefined,
        headerRight: undefined,
      }}
    />
  );
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        backgroundColor: c.background,
      }}
    >
      <ReceiptHeader />
      {children}
    </View>
  );
}

export function NotFound() {
  return (
    <CenteredMessage>
      <Text selectable accessibilityRole="alert" style={{ color: c.text, textAlign: 'center' }}>
        Transaction not found or cannot be viewed here.
      </Text>
    </CenteredMessage>
  );
}

export function ReceiptError({ retry }: { retry: () => void }) {
  return (
    <CenteredMessage>
      <Text selectable accessibilityRole="alert" style={{ color: c.text, textAlign: 'center' }}>
        Could not load the receipt.
      </Text>
      <FormButton label="Retry" variant="secondary" onPress={retry} style={{ marginTop: 16 }} />
    </CenteredMessage>
  );
}

/** An inline alert after a failed refresh. The cached receipt stays below it. */
export function ReceiptRefreshAlert({ retry }: { retry: () => void }) {
  return (
    <View style={{ gap: 12, padding: 20, paddingBottom: 0, backgroundColor: c.background }}>
      <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
        Could not refresh the receipt.
      </Text>
      <FormButton label="Retry" variant="secondary" onPress={retry} />
    </View>
  );
}

function SkeletonField({ label }: { label: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.muted, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Skeleton width="45%" height={16} />
    </View>
  );
}

export function ReceiptSkeleton() {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32, gap: 24 }}
    >
      <ReceiptHeader />
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Loading receipt"
        style={{ gap: 24 }}
      >
        <View style={{ backgroundColor: c.surface, borderRadius: 18, padding: 22, gap: 16 }}>
          <Skeleton width="35%" height={12} />
          <Skeleton width="60%" height={44} />
          <Skeleton width="50%" height={22} />
          <View style={{ height: 1, backgroundColor: c.line }} />
          <View style={{ flexDirection: 'row', gap: 20 }}>
            <SkeletonField label="Account" />
            <SkeletonField label="Date" />
          </View>
        </View>
        <SkeletonField label="Note" />
        <SkeletonField label="Tags" />
        <View style={{ backgroundColor: c.surface, borderRadius: 16, padding: 18, gap: 14 }}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="70%" />
        </View>
      </View>
    </ScrollView>
  );
}
