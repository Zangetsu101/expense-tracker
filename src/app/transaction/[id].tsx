import { AmountInput } from '@/components/amount-input';
import { FormButton, FormInput } from '@/components/form-controls';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { theme } from '@/theme';
import { TransactionReceipt, TransferReceipt } from '@/components/transaction-receipt';
import { TransferForm, useAccounts, type TransferDraft } from '@/components/transfer-form';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight, useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { Host, Switch } from '@expo/ui';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {
  loadEditableTransaction,
  saveTransactionEdit,
  type EditableTransaction,
  type LineItem,
} from '@/lib/transaction-edit';
import { formatEpochDay, formatTransactionAmount } from '@/lib/transaction-format';
import { formatLineItemAmount, parseLineItemAmount } from '@/lib/line-item-amount';
import { deleteTransaction } from '@/lib/transaction-delete';
import type { LendingResult } from '@/lib/lending';
import { loadTransfer, saveTransferEdit, type EditableTransfer } from '@/lib/transfers';
import { dateFromEpochDay, epochDay } from '@/lib/database';

type LoadState = 'loading' | 'missing' | 'ready' | 'error';
type Receipt = EditableTransaction | EditableTransfer;

async function loadReceipt(id: number): Promise<Receipt | null> {
  return (await loadEditableTransaction(id)) ?? (await loadTransfer(id));
}

export default function TransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [editing, setEditing] = useState(false);
  const [transaction, setTransaction] = useState<Receipt | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const [saving, setSaving] = useState(false);
  const [deleting, startDeleting] = useTransition();
  const savingRef = useRef(false);
  const onSavingChange = useCallback((value: boolean) => {
    savingRef.current = value;
    setSaving(value);
  }, []);
  const exitEditing = useCallback(() => {
    setEditing(false);
    setDirty(false);
    setState('loading');
    setTransaction(null);
    setRevision((value) => value + 1);
  }, []);
  const confirming = useRef(false);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const confirmDiscard = useCallback(
    (discard: () => void) => {
      if (savingRef.current || deleting || confirming.current) return;
      if (!dirty) {
        setDirty(false);
        discard();
        return;
      }
      confirming.current = true;
      Alert.alert(
        'Discard changes?',
        'Your unsaved edits will be lost.',
        [
          {
            text: 'Keep editing',
            style: 'cancel',
            onPress: () => {
              confirming.current = false;
            },
          },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              confirming.current = false;
              setDirty(false);
              discard();
            },
          },
        ],
        {
          cancelable: false,
          onDismiss: () => {
            confirming.current = false;
          },
        },
      );
    },
    [dirty, deleting],
  );
  usePreventRemove(editing && (dirty || saving || deleting), ({ data }) => {
    confirmDiscard(() => {
      pendingNavigation.current = () => navigation.dispatch(data.action);
      setEditing(false);
    });
  });
  function runDelete(confirmOverpayment: boolean) {
    startDeleting(async () => {
      let result: LendingResult;
      try {
        result = await deleteTransaction(Number(id), { confirmOverpayment });
      } catch (cause) {
        Alert.alert('Could not delete', String(cause));
        return;
      }
      if (result.status === 'confirmation_required') {
        Alert.alert(
          'Overpayment warning',
          result.warnings
            .map(
              (w) =>
                `${w.currencyCode} · ${w.direction === 'LENT' ? 'They owe you' : 'You owe them'}: overpaid credit ${formatLineItemAmount(w.overpaidMinor)}`,
            )
            .join('\n') +
            '\nDelete anyway? Excess remains visible as credit, not an opposite obligation.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => runDelete(true) },
          ],
        );
        return;
      }
      // React does not keep updates after an await in the transition. Wrap them again.
      startDeleting(() => {
        pendingNavigation.current = () => navigation.goBack();
        setDirty(false);
        setEditing(false);
      });
    });
  }
  function confirmDelete() {
    if (savingRef.current || deleting) return;
    Alert.alert(
      'Delete transaction?',
      'It will be removed from Account balances and reports. You cannot undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => runDelete(false) },
      ],
    );
  }
  useEffect(() => {
    if (!editing && pendingNavigation.current) {
      const resume = pendingNavigation.current;
      pendingNavigation.current = null;
      resume();
    }
  }, [editing]);
  useEffect(() => {
    let active = true;
    // Reset the receipt before loading a different route or retrying a failed read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('loading');
    setTransaction(null);
    const transactionId = Number(id);
    if (!id || !Number.isSafeInteger(transactionId) || transactionId <= 0) {
      setState('missing');
      return () => {
        active = false;
      };
    }
    loadReceipt(transactionId)
      .then((row) => {
        if (!active) return;
        setTransaction(row);
        setState(row ? 'ready' : 'missing');
      })
      .catch((cause) => {
        if (active) {
          setError(String(cause));
          setState('error');
        }
      });
    return () => {
      active = false;
    };
  }, [id, revision]);
  useEffect(() => {
    if (!editing) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmDiscard(exitEditing);
      return true;
    });
    return () => subscription.remove();
  }, [editing, confirmDiscard, exitEditing]);
  const isTransfer = transaction?.type === 'TRANSFER';
  const title = !editing ? 'Receipt' : isTransfer ? 'Edit transfer' : 'Edit transaction';
  const refresh = async () => {
    const refreshed = await loadReceipt(Number(id));
    if (!refreshed) throw new Error('Transaction not found after saving');
    setTransaction(refreshed);
    setDirty(false);
    setEditing(false);
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      enabled={editing}
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={headerHeight}
    >
      <Stack.Screen
        options={{
          title,
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.text,
          gestureEnabled: !editing,
          headerLeft: editing
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  accessibilityState={{ disabled: saving }}
                  onPress={() => confirmDiscard(exitEditing)}
                  style={{ paddingVertical: 12, marginRight: theme.spacing.lg }}
                >
                  <Text style={{ color: theme.colors.accent }}>Cancel</Text>
                </Pressable>
              )
            : undefined,
          headerRight:
            !editing && state === 'ready'
              ? () => (
                  <Pressable accessibilityRole="button" onPress={() => setEditing(true)}>
                    <Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: '600' }}>
                      Edit
                    </Text>
                  </Pressable>
                )
              : undefined,
        }}
      />
      {editing && transaction ? (
        transaction.type === 'TRANSFER' ? (
          <EditTransferScreen
            transfer={transaction}
            deleting={deleting}
            onDirtyChange={setDirty}
            onSavingChange={onSavingChange}
            onCancel={() => confirmDiscard(exitEditing)}
            onDelete={confirmDelete}
            onSaved={refresh}
          />
        ) : (
          <EditTransactionScreen
            transaction={transaction}
            deleting={deleting}
            onDirtyChange={setDirty}
            onSavingChange={onSavingChange}
            onCancel={() => confirmDiscard(exitEditing)}
            onDelete={confirmDelete}
            onSaved={refresh}
          />
        )
      ) : state === 'ready' && transaction ? (
        transaction.type === 'TRANSFER' ? (
          <TransferReceipt key={transaction.id} transfer={transaction} />
        ) : (
          <TransactionReceipt key={transaction.id} transaction={transaction} />
        )
      ) : (
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
            backgroundColor: theme.colors.background,
          }}
        >
          {state === 'loading' ? (
            <ActivityIndicator accessibilityLabel="Loading receipt" />
          ) : (
            <>
              <Text
                selectable
                accessibilityRole="alert"
                style={{ color: theme.colors.text, textAlign: 'center' }}
              >
                {state === 'error' ? error : 'Transaction not found or cannot be viewed here.'}
              </Text>
              {state === 'error' && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRevision((value) => value + 1)}
                  style={{ padding: 16 }}
                >
                  <Text style={{ color: theme.colors.accent }}>Retry</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function EditTransactionScreen({
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

function EditTransferScreen({
  transfer,
  deleting,
  onDirtyChange,
  onSavingChange,
  onCancel,
  onDelete,
  onSaved,
}: {
  transfer: EditableTransfer;
  deleting: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
  onCancel: () => void;
  onDelete: () => void;
  onSaved: () => Promise<void>;
}) {
  const { accounts, loading, error } = useAccounts();
  const [committed, setCommitted] = useState(false);
  const [initial] = useState(() => ({
    fromId: transfer.fromAccountId,
    toId: transfer.toAccountId,
    amount: formatLineItemAmount(transfer.amountMinor),
    note: transfer.note ?? '',
    date: dateFromEpochDay(transfer.date),
  }));
  const dirtyChange = useCallback(
    (dirty: boolean) => onDirtyChange(dirty && !committed),
    [onDirtyChange, committed],
  );
  const submit = async ({ amountMinor, fromAccountId, toAccountId, note, date }: TransferDraft) => {
    onSavingChange(true);
    try {
      if (!committed) {
        await saveTransferEdit(transfer, {
          amountMinor,
          fromAccountId,
          toAccountId,
          note,
          date: epochDay(date),
        });
        setCommitted(true);
      }
      await onSaved();
    } finally {
      onSavingChange(false);
    }
  };
  return (
    <TransferForm
      accounts={accounts}
      loading={loading}
      loadError={error}
      initial={initial}
      editDate
      fieldsLocked={committed || deleting}
      submitLabel={committed ? 'Retry receipt' : 'Save changes'}
      onSubmit={submit}
      onDirtyChange={dirtyChange}
      onCancel={onCancel}
      onDelete={onDelete}
    />
  );
}
