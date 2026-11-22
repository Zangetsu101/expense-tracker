import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight, useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { TransactionReceipt, TransferReceipt } from '@/components/transaction-receipt';
import { ExpenseReimbursementPanels, ReimbursedExpense } from '@/components/reimbursement-receipt';
import { TransferFormSection, type TransferDraft } from './transfer-edit';
import { dateFromEpochDay, epochDay } from '@/lib/database';
import { deleteLendingEntry } from '@/lib/lending';
import { WriteOffForm } from '@/features/lending/write-off-form';
import { writeWithOverpaidCreditCheck } from '@/features/lending/view';
import { FormButton } from '@/components/form-controls';
import { deleteTransaction } from '@/lib/transaction-delete';
import { saveTransferEdit, type EditableTransfer } from '@/lib/transfers';
import { theme } from '@/theme';
import { receiptQuery, writeOffReceiptQuery, type Receipt } from './queries.ts';
import { QueryBoundary } from '@/components/query-error-boundary';
import {
  EditTransactionScreen,
  NotFound,
  ReceiptError,
  ReceiptRefreshAlert,
  ReceiptSkeleton,
} from './view.tsx';

function PostedTransactionReceipt({
  transaction,
}: {
  transaction: Exclude<Receipt, EditableTransfer>;
}) {
  const writeOff = transaction.type === 'WRITE_OFF';
  const reimbursement = writeOff ? undefined : transaction.reimbursementDetails;
  const reimbursedExpense = reimbursement?.expense;
  const showEmptyDetails = !writeOff && !transaction.lendingKind && !reimbursedExpense;

  return (
    <TransactionReceipt>
      <TransactionReceipt.Summary transaction={transaction} reimbursement={reimbursement} />
      {reimbursedExpense && <ReimbursedExpense expense={reimbursedExpense} />}
      {transaction.type === 'EXPENSE' && reimbursement && (
        <ExpenseReimbursementPanels
          details={reimbursement}
          amount={transaction.amountMinor}
          currency={transaction.currencyCode}
        />
      )}
      {!reimbursedExpense && !!transaction.personId && !!transaction.personName && (
        <TransactionReceipt.Person id={transaction.personId} name={transaction.personName} />
      )}
      <TransactionReceipt.Note note={transaction.note} />
      {!writeOff && (
        <>
          {(showEmptyDetails || !!transaction.tags.length) && (
            <TransactionReceipt.Tags tags={transaction.tags} />
          )}
          {(showEmptyDetails || !!transaction.lineItems.length) && (
            <TransactionReceipt.Items row={transaction} />
          )}
          <TransactionReceipt.Reports
            transaction={transaction}
            reimbursedExpense={reimbursedExpense}
          />
        </>
      )}
    </TransactionReceipt>
  );
}

function ReceiptSession({ id, writeOff }: { id: number; writeOff: boolean }) {
  const client = useQueryClient();
  const query = writeOff ? writeOffReceiptQuery(id) : receiptQuery(id);
  const { data, error, isFetching, refetch } = useSuspenseQuery(query);
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
  usePreventRemove(editing && !closing && (dirty || saving || deleting), ({ repeat }) => {
    confirmDiscard(() => {
      pendingNavigation.current = repeat;
      exitEditing();
    });
  });
  function runDelete() {
    startDeleting(async () => {
      let deleted;
      try {
        deleted = await writeWithOverpaidCreditCheck(
          (confirmOverpayment) =>
            writeOff
              ? deleteLendingEntry(id, { confirmDelete: true, confirmOverpayment })
              : deleteTransaction(id, { confirmOverpayment }),
          'Delete',
        );
      } catch (cause) {
        Alert.alert('Could not delete', String(cause));
        return;
      }
      if (!deleted) return;
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
      writeOff ? 'Delete write-off?' : 'Delete transaction?',
      writeOff
        ? 'This changes the person’s balance. You cannot undo this.'
        : 'It will be removed from Account balances and reports. You cannot undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: runDelete },
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
    const refreshed = await client.fetchQuery(query);
    if (!refreshed) throw new Error('Transaction not found after saving');
    exitEditing();
  };
  if (!editing && !data) return <NotFound />;
  const title = !snapshot
    ? 'Receipt'
    : snapshot.type === 'TRANSFER'
      ? 'Edit transfer'
      : snapshot.type === 'WRITE_OFF'
        ? 'Edit write-off'
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
        ) : snapshot.type === 'WRITE_OFF' ? (
          <ScrollView
            style={{ flex: 1, backgroundColor: theme.colors.background }}
            contentContainerStyle={{ padding: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            <WriteOffForm
              id={id}
              personId={snapshot.personId}
              kind={snapshot.kind}
              currency={snapshot.currencyCode}
              initialAmount={snapshot.amountMinor}
              initialDate={snapshot.date}
              initialNote={snapshot.note ?? ''}
              onDirtyChange={setDirty}
              onSavingChange={onSavingChange}
              disabled={deleting || closing}
              onSaved={onSaved}
            >
              <FormButton label="Delete write-off" variant="danger" onPress={confirmDelete} />
            </WriteOffForm>
          </ScrollView>
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
            <PostedTransactionReceipt key={data.id} transaction={data} />
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
    amountMinor: transfer.amountMinor,
    receivedAmountMinor:
      transfer.receivedAmountMinor ??
      (transfer.currencyCode !== transfer.destinationCurrencyCode ? transfer.amountMinor : null),
    note: transfer.note ?? '',
    date: dateFromEpochDay(transfer.date),
  }));
  const dirtyChange = useCallback(
    (dirty: boolean) => onDirtyChange(dirty && !committed),
    [onDirtyChange, committed],
  );
  const submit = async ({
    amountMinor,
    receivedAmountMinor,
    fromAccountId,
    toAccountId,
    note,
    date,
  }: TransferDraft) => {
    onSavingChange(true);
    try {
      if (!committed) {
        await saveTransferEdit(transfer, {
          amountMinor,
          receivedAmountMinor,
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
      fieldsLocked={committed || deleting}
      deleting={deleting}
      submitLabel={committed ? 'Retry receipt' : 'Save changes'}
      onSubmit={submit}
      onDirtyChange={dirtyChange}
      onCancel={onCancel}
      onDelete={onDelete}
    />
  );
}

export default function TransactionScreen() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const writeOff = kind === 'write-off';
  const transactionId = Number(id);
  if (!id || !Number.isSafeInteger(transactionId) || transactionId <= 0) return <NotFound />;
  return (
    <QueryBoundary
      key={`${transactionId}:${writeOff}`}
      pending={<ReceiptSkeleton />}
      error={(retry) => <ReceiptError retry={retry} />}
    >
      <ReceiptSession id={transactionId} writeOff={writeOff} />
    </QueryBoundary>
  );
}
