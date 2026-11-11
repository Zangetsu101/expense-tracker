import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight, useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { Alert, BackHandler, KeyboardAvoidingView, Pressable, Text, View } from 'react-native';
import { TransactionReceipt, TransferReceipt } from '@/components/transaction-receipt';
import { TransferFormSection, type TransferDraft } from '@/features/transfer';
import { dateFromEpochDay, epochDay } from '@/lib/database';
import type { LendingResult } from '@/lib/lending';
import { formatLineItemAmount } from '@/lib/line-item-amount';
import { deleteTransaction } from '@/lib/transaction-delete';
import { saveTransferEdit, type EditableTransfer } from '@/lib/transfers';
import { theme } from '@/theme';
import { receiptQuery, type Receipt } from './queries.ts';
import { QueryBoundary } from '@/components/query-error-boundary';
import {
  EditTransactionScreen,
  NotFound,
  ReceiptError,
  ReceiptRefreshAlert,
  ReceiptSkeleton,
} from './view.tsx';

function ReceiptSession({ id }: { id: number }) {
  const client = useQueryClient();
  const { data, error, isFetching, refetch } = useSuspenseQuery(receiptQuery(id));
  // The form edits this copy. Thus a refresh does not change an open form.
  const [snapshot, setSnapshot] = useState<Receipt>();
  const editing = snapshot !== undefined;
  // After a delete the screen closes. It keeps the form so that it never shows "Not found".
  const [closing, setClosing] = useState(false);
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
    setSnapshot(undefined);
    setDirty(false);
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
  usePreventRemove(editing && !closing && (dirty || saving || deleting), ({ data: removal }) => {
    confirmDiscard(() => {
      pendingNavigation.current = () => navigation.dispatch(removal.action);
      exitEditing();
    });
  });
  function runDelete(confirmOverpayment: boolean) {
    startDeleting(async () => {
      let result: LendingResult;
      try {
        result = await deleteTransaction(id, { confirmOverpayment });
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
        setDirty(false);
        setClosing(true);
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
    if (closing) navigation.goBack();
  }, [closing, navigation]);
  useEffect(() => {
    if (!editing && pendingNavigation.current) {
      const resume = pendingNavigation.current;
      pendingNavigation.current = null;
      resume();
    }
  }, [editing]);
  useEffect(() => {
    if (!editing) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmDiscard(exitEditing);
      return true;
    });
    return () => subscription.remove();
  }, [editing, confirmDiscard, exitEditing]);
  // A committed save is never reported as a failed save. If this read fails,
  // the form stays locked and offers "Retry receipt".
  const onSaved = async () => {
    const refreshed = await client.fetchQuery(receiptQuery(id));
    if (!refreshed) throw new Error('Transaction not found after saving');
    exitEditing();
  };
  if (!editing && !data) return <NotFound />;
  const title = !snapshot
    ? 'Receipt'
    : snapshot.type === 'TRANSFER'
      ? 'Edit transfer'
      : 'Edit transaction';
  const canEdit = !isFetching && !error;
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
          headerRight: !editing
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  disabled={!canEdit}
                  accessibilityState={{ disabled: !canEdit }}
                  onPress={() => setSnapshot(data ?? undefined)}
                  style={{ opacity: canEdit ? 1 : 0.45 }}
                >
                  <Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: '600' }}>
                    Edit
                  </Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      {snapshot ? (
        snapshot.type === 'TRANSFER' ? (
          <EditTransferScreen
            transfer={snapshot}
            deleting={deleting || closing}
            onDirtyChange={setDirty}
            onSavingChange={onSavingChange}
            onCancel={() => confirmDiscard(exitEditing)}
            onDelete={confirmDelete}
            onSaved={onSaved}
          />
        ) : (
          <EditTransactionScreen
            transaction={snapshot}
            deleting={deleting || closing}
            onDirtyChange={setDirty}
            onSavingChange={onSavingChange}
            onCancel={() => confirmDiscard(exitEditing)}
            onDelete={confirmDelete}
            onSaved={onSaved}
          />
        )
      ) : data ? (
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          {!!error && !isFetching && <ReceiptRefreshAlert retry={() => void refetch()} />}
          {data.type === 'TRANSFER' ? (
            <TransferReceipt key={data.id} transfer={data} />
          ) : (
            <TransactionReceipt key={data.id} transaction={data} />
          )}
        </View>
      ) : null}
    </KeyboardAvoidingView>
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
    <TransferFormSection
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

export default function TransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const transactionId = Number(id);
  if (!id || !Number.isSafeInteger(transactionId) || transactionId <= 0) return <NotFound />;
  return (
    <QueryBoundary
      key={String(transactionId)}
      pending={<ReceiptSkeleton />}
      error={(retry) => <ReceiptError retry={retry} />}
    >
      <ReceiptSession id={transactionId} />
    </QueryBoundary>
  );
}
