import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight, useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { Alert, BackHandler, KeyboardAvoidingView, Pressable, Text, View } from 'react-native';
import { TransactionReceipt, TransferReceipt } from '@/components/transaction-receipt';
import { TransferFormSection, type TransferDraft } from '@/features/transfer';
import { dateFromEpochDay, epochDay } from '@/lib/database';
import { errorMessage } from '@/lib/error-message';
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
  type ReceiptSave,
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
  // A committed save is never reported as a failed save. The write waits for the read of
  // the receipt. If that read fails, the write is still a success, and the form stays
  // open and locked with "Retry receipt".
  const showSaved = async () => {
    // The committed write already started this read. Join it.
    const read = await refetch({ cancelRefetch: false });
    if (!read.isError) exitEditing();
  };
  const write = useMutation({
    mutationKey: ['receipt', id, 'save'],
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: showSaved,
  });
  const resetWrite = write.reset;
  const exitEditing = useCallback(() => {
    setSnapshot(undefined);
    setDirty(false);
    resetWrite();
  }, [resetWrite]);
  // The form is still open after a successful write only if the read of the receipt failed.
  const committed = write.isSuccess;
  const saving = write.isPending || (committed && isFetching);
  const save: ReceiptSave = {
    pending: saving,
    committed,
    error: write.error ?? (committed ? error : null),
    start: (run) => {
      if (saving) return;
      if (committed) void showSaved();
      else write.mutate(run);
    },
    clearError: () => {
      if (!committed) resetWrite();
    },
  };
  const remove = useMutation({
    mutationFn: (confirmOverpayment: boolean) => deleteTransaction(id, { confirmOverpayment }),
    onSuccess: (result) => {
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
            { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(true) },
          ],
        );
        return;
      }
      setDirty(false);
      setClosing(true);
    },
    onError: (cause) => Alert.alert('Could not delete', String(cause)),
  });
  const deleting = remove.isPending;
  const confirming = useRef(false);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const confirmDiscard = useCallback(
    (discard: () => void) => {
      // The pending state of the render can be late. Ask the mutation cache.
      if (
        client.isMutating({ mutationKey: ['receipt', id, 'save'] }) ||
        saving ||
        deleting ||
        confirming.current
      )
        return;
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
    [client, id, dirty, saving, deleting],
  );
  usePreventRemove(editing && !closing && (dirty || saving || deleting), ({ data: removal }) => {
    confirmDiscard(() => {
      pendingNavigation.current = () => navigation.dispatch(removal.action);
      exitEditing();
    });
  });
  function confirmDelete() {
    if (saving || deleting) return;
    Alert.alert(
      'Delete transaction?',
      'It will be removed from Account balances and reports. You cannot undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(false) },
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
            save={save}
            onDirtyChange={setDirty}
            onCancel={() => confirmDiscard(exitEditing)}
            onDelete={confirmDelete}
          />
        ) : (
          <EditTransactionScreen
            transaction={snapshot}
            deleting={deleting || closing}
            save={save}
            onDirtyChange={setDirty}
            onCancel={() => confirmDiscard(exitEditing)}
            onDelete={confirmDelete}
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
  save,
  onDirtyChange,
  onCancel,
  onDelete,
}: {
  transfer: EditableTransfer;
  deleting: boolean;
  save: ReceiptSave;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { committed } = save;
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
  return (
    <TransferFormSection
      initial={initial}
      editDate
      fieldsLocked={committed || deleting}
      submitLabel={committed ? 'Retry receipt' : 'Save changes'}
      pending={save.pending}
      error={save.error ? errorMessage(save.error) : undefined}
      onClearError={save.clearError}
      onSubmit={({ amountMinor, fromAccountId, toAccountId, note, date }: TransferDraft) =>
        save.start(() =>
          saveTransferEdit(transfer, {
            amountMinor,
            fromAccountId,
            toAccountId,
            note,
            date: epochDay(date),
          }),
        )
      }
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
