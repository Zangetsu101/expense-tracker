import { useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
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
  listLendingEntries,
  listPeople,
  saveLendingEntry,
  type LendingInput,
  type LendingKind,
  type Person,
  type LendingResult,
} from '@/lib/lending';
import { dateFromEpochDay, epochDay, listAccounts, type Account } from '@/lib/database';
import { transferAmountMinor } from '@/lib/transfers';
import { FormButton, FormInput } from '@/components/form-controls';
import { QuickAddDate } from '@/components/quick-add-date';
import { theme } from '@/theme';

const c = theme.colors;
const labels: Record<LendingKind, string> = {
  LEND: 'Lend',
  BORROW: 'Borrow',
  RECEIVE_REPAYMENT: 'Receive repayment',
  REPAY: 'Repay',
  WRITE_OFF_LENT: 'Write off what they owe',
  WRITE_OFF_BORROWED: 'Write off what you owe',
};
export default function EntryScreen() {
  const params = useLocalSearchParams<{ id?: string; personId?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const [people, setPeople] = useState<Person[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [personId, setPersonId] = useState(Number(params.personId) || undefined);
  const [kind, setKind] = useState<LendingKind>('LEND');
  const [originalWriteoff, setOriginalWriteoff] = useState<boolean>();
  const [accountId, setAccountId] = useState<number>();
  const [currency, setCurrency] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date());
  const [picker, setPicker] = useState<'person' | 'account' | 'kind' | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    // Clear the previous route's form while its replacement loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    Promise.all([listPeople(), listAccounts(), id ? listLendingEntries() : Promise.resolve([])])
      .then(([p, a, entries]) => {
        if (!active) return;
        setPeople(p);
        setAccounts(a);
        setAccountId(a[0]?.id);
        setCurrency(a[0]?.currencyCode ?? '');
        if (id) {
          const entry = entries.find((e) => e.id === id);
          if (!entry) throw new Error('Entry not found.');
          setPersonId(entry.personId);
          setKind(entry.kind);
          setOriginalWriteoff(entry.kind.startsWith('WRITE_OFF'));
          setAccountId(entry.accountId ?? undefined);
          setCurrency(entry.currencyCode);
          setAmount((entry.amountMinor / 100).toFixed(2));
          setNote(entry.note ?? '');
          setDate(dateFromEpochDay(entry.date));
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, retry]);
  const writeoff = kind.startsWith('WRITE_OFF');
  const person = people.find((p) => p.id === personId);
  const account = accounts.find((a) => a.id === accountId);
  function confirm(result: LendingResult, action: () => void) {
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
  async function save(confirmed = false) {
    if (pending) return;
    setError('');
    setPending(true);
    try {
      if (!personId) throw new Error('Choose a person.');
      const draft: LendingInput = {
        id,
        personId,
        kind,
        amountMinor: transferAmountMinor(amount),
        accountId: writeoff ? undefined : accountId,
        currencyCode: currency,
        date: epochDay(date),
        note,
        confirmOverpayment: confirmed,
      };
      confirm(await saveLendingEntry(draft), () => void save(true));
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  async function remove(confirmed = false) {
    if (!id || pending) return;
    setError('');
    setPending(true);
    try {
      confirm(
        await deleteLendingEntry(id, { confirmDelete: true, confirmOverpayment: confirmed }),
        () => void remove(true),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  async function addPerson() {
    setPending(true);
    setError('');
    try {
      const p = await createPerson(name);
      setPeople([...people, p]);
      setPersonId(p.id);
      setName('');
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: id ? 'Edit lending entry' : 'Add lending entry' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 64 }}
      >
        {loading && <ActivityIndicator color={c.accent} />}
        {!!error && (
          <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
            {error}
          </Text>
        )}
        {!loading && !people.length && <Text style={{ color: c.muted }}>Save a person first.</Text>}
        {!loading && (
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
              disabled={!name.trim() || pending}
              onPress={() => void addPerson()}
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
              disabled={!person || (!writeoff && !account) || !amount}
              onPress={() => void save()}
            />
            {!!id && (
              <FormButton
                label="Delete entry"
                variant="danger"
                disabled={pending}
                onPress={() =>
                  Alert.alert(
                    'Delete entry?',
                    'This removes the entry and its linked Account movement, if any. Balances will be recalculated.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => void remove() },
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
        )}
        {!!error && (
          <FormButton
            label="Reload data"
            variant="secondary"
            disabled={pending}
            onPress={() => setRetry(retry + 1)}
          />
        )}
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
