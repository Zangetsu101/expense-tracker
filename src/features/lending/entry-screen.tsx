import { useState } from 'react';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';
import {
  BottomSheet,
  Button,
  Column,
  Host,
  ScrollView as NativeScrollView,
  Text as NativeText,
} from '@expo/ui';
import {
  createPerson,
  deleteLendingEntry,
  saveLendingEntry,
  type LendingKind,
  type LendingResult,
} from '@/lib/lending';
import { dateFromEpochDay, epochDay } from '@/lib/database';
import { parsePositiveAmountMinor } from '@/lib/amount';
import { FormButton, FormInput } from '@/components/form-controls';
import { QuickAddDate } from '@/components/quick-add-date';
import { theme } from '@/theme';
import { includeCreatedPerson, lendingEntryFormQuery } from './queries.ts';
import { QueryBoundary } from '@/components/query-error-boundary';
import { ButtonSkeleton, FallbackScroll, LendingAlert, LoadingGroup } from './view.tsx';

const c = theme.colors;
const labels: Record<LendingKind, string> = {
  LEND: 'Lend',
  BORROW: 'Borrow',
  RECEIVE_REPAYMENT: 'Receive repayment',
  REPAY: 'Repay',
  WRITE_OFF_LENT: 'Write off what they owe',
  WRITE_OFF_BORROWED: 'Write off what you owe',
};
function EntryForm({ id, initialPersonId }: { id?: number; initialPersonId?: number }) {
  const client = useQueryClient();
  const { data, isFetching } = useSuspenseQuery(lendingEntryFormQuery(id));
  const { people, accounts, entry } = data;
  const [personId, setPersonId] = useState(() => entry?.personId ?? initialPersonId);
  const [kind, setKind] = useState<LendingKind>(() => entry?.kind ?? 'LEND');
  const [originalWriteoff] = useState(() => entry?.kind.startsWith('WRITE_OFF'));
  const [accountId, setAccountId] = useState(() =>
    entry ? (entry.accountId ?? undefined) : accounts[0]?.id,
  );
  const [currency, setCurrency] = useState(
    () => entry?.currencyCode ?? accounts[0]?.currencyCode ?? '',
  );
  const [amount, setAmount] = useState(() => (entry ? (entry.amountMinor / 100).toFixed(2) : ''));
  const [note, setNote] = useState(() => entry?.note ?? '');
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => (entry ? dateFromEpochDay(entry.date) : new Date()));
  const [picker, setPicker] = useState<'person' | 'account' | 'kind' | null>(null);
  const writeoff = kind.startsWith('WRITE_OFF');
  const person = people.find((p) => p.id === personId);
  const account = accounts.find((a) => a.id === accountId);
  function finish(result: LendingResult, action: () => void) {
    if (result.status !== 'confirmation_required') {
      router.back();
      return;
    }
    Alert.alert(
      'Overpayment warning',
      result.warnings
        .map(
          (w) =>
            `${w.currencyCode} · ${w.direction === 'LENT' ? 'They owe you' : 'You owe them'}: overpaid credit ${(w.overpaidMinor / 100).toFixed(2)}`,
        )
        .join('\n') +
        '\nSave anyway? Excess remains visible as credit, not an opposite obligation.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: action },
      ],
    );
  }
  const save = useMutation({
    mutationFn: async (confirmed: boolean) => {
      if (!personId) throw new Error('Choose a person.');
      return saveLendingEntry({
        id,
        personId,
        kind,
        amountMinor: parsePositiveAmountMinor(amount),
        accountId: writeoff ? undefined : accountId,
        currencyCode: currency,
        date: epochDay(date),
        note,
        confirmOverpayment: confirmed,
      });
    },
    onSuccess: (result) => finish(result, () => save.mutate(true)),
  });
  const remove = useMutation({
    mutationFn: async (confirmed: boolean) => {
      if (!id) throw new Error('Entry not found.');
      return deleteLendingEntry(id, { confirmDelete: true, confirmOverpayment: confirmed });
    },
    onSuccess: (result) => finish(result, () => remove.mutate(true)),
  });
  const addPerson = useMutation({
    mutationFn: (personName: string) => createPerson(personName),
    onSuccess: (created) => {
      includeCreatedPerson(client, id, created);
      setPersonId(created.id);
      setName('');
    },
  });
  const pending = save.isPending || remove.isPending || addPerson.isPending;
  const locked = pending || isFetching;
  const error = save.error ?? remove.error ?? addPerson.error;
  /** Starts a write. The error of the last write goes away. */
  function start(write: () => void) {
    if (pending) return;
    save.reset();
    remove.reset();
    addPerson.reset();
    write();
  }
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 64 }}
      >
        {!!error && (
          <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
            {String(error)}
          </Text>
        )}
        {!people.length && <Text style={{ color: c.muted }}>Save a person first.</Text>}
        <>
          <FormButton
            label={`Action: ${labels[kind]}`}
            variant="secondary"
            disabled={pending}
            onPress={() => setPicker('kind')}
          />
          <FormButton
            label={`${kind === 'LEND' || kind === 'RECEIVE_REPAYMENT' || kind === 'WRITE_OFF_LENT' ? 'Borrower' : 'Lender'}: ${person?.name ?? 'Choose person'}`}
            variant="secondary"
            disabled={pending}
            onPress={() => setPicker('person')}
          />
          <FormInput
            accessibilityLabel="New person name"
            placeholder="New person name"
            value={name}
            onChangeText={setName}
            editable={!pending}
          />
          <FormButton
            label="Save new person"
            variant="secondary"
            disabled={!name.trim() || locked}
            onPress={() => start(() => addPerson.mutate(name))}
          />
          {writeoff ? (
            <>
              <Text style={{ color: c.muted }}>
                Write-offs reduce this obligation without changing Account balances or reports.
              </Text>
              <FormInput
                accessibilityLabel="Write-off currency"
                placeholder="Currency (e.g. BDT)"
                autoCapitalize="characters"
                value={currency}
                onChangeText={setCurrency}
                editable={!pending}
              />
            </>
          ) : (
            <FormButton
              label={`Account: ${account ? `${account.name} · ${account.currencyCode}` : 'Choose Account'}`}
              variant="secondary"
              disabled={pending}
              onPress={() => setPicker('account')}
            />
          )}
          <Text style={{ color: c.muted }}>
            Repayments reduce aggregate outstanding in this direction and currency, not an
            individual loan.
          </Text>
          <FormInput
            accessibilityLabel="Amount"
            placeholder="Amount"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            editable={!pending}
          />
          <QuickAddDate value={date} onChange={setDate} disabled={pending} />
          <FormInput
            accessibilityLabel="Note"
            placeholder="Note (optional)"
            value={note}
            onChangeText={setNote}
            editable={!pending}
          />
          <FormButton
            label="Save entry"
            loading={pending}
            disabled={locked || !person || (!writeoff && !account) || !amount}
            onPress={() => start(() => save.mutate(false))}
          />
          {!!id && (
            <FormButton
              label="Delete entry"
              variant="danger"
              disabled={locked}
              onPress={() =>
                Alert.alert(
                  'Delete entry?',
                  'This removes the entry and its linked Account movement, if any. Balances will be recalculated.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => start(() => remove.mutate(false)),
                    },
                  ],
                )
              }
            />
          )}
          <FormButton
            label="Cancel"
            variant="secondary"
            disabled={pending}
            onPress={() => router.back()}
          />
        </>
      </ScrollView>
      <Host>
        <BottomSheet
          isPresented={picker !== null}
          onDismiss={() => setPicker(null)}
          snapPoints={['half', 'full']}
        >
          <NativeScrollView>
            <Column>
              <NativeText>
                {picker === 'kind'
                  ? 'Choose action'
                  : picker === 'person'
                    ? 'Saved people'
                    : 'Accounts'}
              </NativeText>
              {picker === 'kind' &&
                (Object.keys(labels) as LendingKind[])
                  .filter(
                    (k) =>
                      originalWriteoff === undefined ||
                      k.startsWith('WRITE_OFF') === originalWriteoff,
                  )
                  .map((k) => (
                    <Button
                      key={k}
                      label={labels[k]}
                      onPress={() => {
                        setKind(k);
                        setPicker(null);
                      }}
                    />
                  ))}
              {picker === 'person' &&
                people.map((p) => (
                  <Button
                    key={p.id}
                    label={p.name}
                    onPress={() => {
                      setPersonId(p.id);
                      setPicker(null);
                    }}
                  />
                ))}
              {picker === 'account' &&
                accounts.map((a) => (
                  <Button
                    key={a.id}
                    label={`${a.name} · ${a.currencyCode}`}
                    onPress={() => {
                      setAccountId(a.id);
                      setCurrency(a.currencyCode);
                      setPicker(null);
                    }}
                  />
                ))}
            </Column>
          </NativeScrollView>
        </BottomSheet>
      </Host>
    </View>
  );
}

function EntryFormSkeleton() {
  return (
    <FallbackScroll>
      <LoadingGroup label="Loading entry form">
        <ButtonSkeleton />
        <ButtonSkeleton />
        <ButtonSkeleton />
        <ButtonSkeleton />
        <ButtonSkeleton />
        <ButtonSkeleton />
        <ButtonSkeleton />
        <ButtonSkeleton />
      </LoadingGroup>
    </FallbackScroll>
  );
}

function EntryFormError({ retry }: { retry: () => void }) {
  return (
    <FallbackScroll>
      <LendingAlert message="Could not load the entry form." retry={retry} />
      <FormButton label="Cancel" variant="secondary" onPress={() => router.back()} />
    </FallbackScroll>
  );
}

export default function EntryScreen() {
  const params = useLocalSearchParams<{ id?: string; personId?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: id ? 'Edit lending entry' : 'Add lending entry' }} />
      <QueryBoundary
        key={id === undefined ? 'new' : String(id)}
        pending={<EntryFormSkeleton />}
        error={(retry) => <EntryFormError retry={retry} />}
      >
        <EntryForm id={id} initialPersonId={Number(params.personId) || undefined} />
      </QueryBoundary>
    </View>
  );
}
