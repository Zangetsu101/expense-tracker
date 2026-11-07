import { useEffect, useState } from 'react';
import { BottomSheet, Button, Column, Host, Text as NativeText } from '@expo/ui';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { listAccounts, type Account } from '@/lib/database';
import { parsePositiveAmountMinor } from '@/lib/amount';
import { QuickAddDate } from '@/components/quick-add-date';
import { theme } from '@/theme';
import { FormButton, FormInput } from '@/components/form-controls';

type Side = 'source' | 'destination';
export type TransferDraft = {
  amountMinor: number;
  fromAccountId: number;
  toAccountId: number;
  note: string;
  date: Date;
};
type Props = {
  accounts: Account[];
  loading?: boolean;
  loadError?: string;
  initial?: { fromId?: number; toId?: number; amount?: string; note?: string; date?: Date };
  editDate?: boolean;
  submitLabel: string;
  intro?: string;
  fieldsLocked?: boolean;
  onSubmit: (draft: TransferDraft) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel?: () => void;
};
const { text: ink, muted, surface, accent } = theme.colors;

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    listAccounts()
      .then(setAccounts)
      .catch((cause) => setError(String(cause)))
      .finally(() => setLoading(false));
  }, []);
  return { accounts, loading, error };
}

export function TransferForm({
  accounts,
  loading = false,
  loadError,
  initial = {},
  editDate = false,
  submitLabel,
  intro,
  fieldsLocked = false,
  onSubmit,
  onDirtyChange,
  onCancel,
}: Props) {
  const [fromId, setFromId] = useState(initial.fromId);
  const [toId, setToId] = useState(initial.toId);
  const [amount, setAmount] = useState(initial.amount ?? '');
  const [note, setNote] = useState(initial.note ?? '');
  const [date, setDate] = useState(() => initial.date ?? new Date());
  const [picker, setPicker] = useState<Side | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    // Accounts arrive asynchronously; select the first only if none is selected.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fromId === undefined && accounts[0]) setFromId(accounts[0].id);
  }, [accounts, fromId]);
  const dirty =
    fromId !== initial.fromId ||
    toId !== initial.toId ||
    amount !== (initial.amount ?? '') ||
    note !== (initial.note ?? '') ||
    (editDate && date.getTime() !== initial.date?.getTime());
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const locked = pending || fieldsLocked;
  const source = accounts.find((account) => account.id === fromId);
  const destination = accounts.find((account) => account.id === toId);
  const eligible = accounts.filter(
    (account) => account.id !== fromId && account.currencyCode === source?.currencyCode,
  );
  const canSwap =
    !!source &&
    !!destination &&
    source.id !== destination.id &&
    source.currencyCode === destination.currencyCode;
  let validAmount = false;
  try {
    parsePositiveAmountMinor(amount);
    validAmount = true;
  } catch {}

  function choose(side: Side, account: Account) {
    if (side === 'source') {
      setFromId(account.id);
      if (account.id === toId || account.currencyCode !== destination?.currencyCode)
        setToId(undefined);
    } else if (account.id !== fromId && account.currencyCode === source?.currencyCode)
      setToId(account.id);
    setPicker(null);
    setError(undefined);
  }

  async function save() {
    if (pending) return;
    try {
      const amountMinor = parsePositiveAmountMinor(amount);
      if (
        !source ||
        !destination ||
        source.id === destination.id ||
        source.currencyCode !== destination.currencyCode
      )
        throw new Error('Select two different accounts with the same currency.');
      setPending(true);
      setError(undefined);
      await onSubmit({
        amountMinor,
        fromAccountId: source.id,
        toAccountId: destination.id,
        note,
        date,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  function accountSelector(side: Side) {
    const account = side === 'source' ? source : destination;
    const label = side === 'source' ? 'From' : 'To';
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} account: ${account ? `${account.name}, ${account.currencyCode}` : 'Not selected'}`}
        accessibilityHint="Opens account chooser"
        disabled={loading || locked}
        onPress={() => setPicker(side)}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 88,
          backgroundColor: surface,
          borderRadius: 16,
          padding: 10,
          gap: 2,
          borderWidth: 1,
          borderColor: theme.colors.line,
        }}
      >
        <Text style={{ color: muted, fontSize: 13 }} accessible={false}>
          {label}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
          <Text
            numberOfLines={2}
            accessible={false}
            style={{ color: ink, fontSize: 16, lineHeight: 20, flex: 1, minWidth: 0 }}
          >
            {account?.name ?? 'Choose account'}
          </Text>
          <Text style={{ color: ink, fontSize: 18 }} accessible={false}>
            ›
          </Text>
        </View>
        <Text numberOfLines={1} accessible={false} style={{ color: muted }}>
          {account?.currencyCode ??
            (source ? `Select a ${source.currencyCode} account` : 'Select a source first')}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 20 }}
      >
        {loadError && (
          <Text selectable accessibilityRole="alert" style={{ color: theme.colors.warning }}>
            {loadError}
          </Text>
        )}
        {!!intro && <Text style={{ color: muted }}>{intro}</Text>}
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          {accountSelector('source')}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Swap accounts"
            accessibilityState={{ disabled: !canSwap || locked }}
            disabled={!canSwap || locked}
            onPress={() => {
              setFromId(destination!.id);
              setToId(source!.id);
              setError(undefined);
            }}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: theme.colors.raised,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canSwap && !locked ? 1 : 0.5,
            }}
          >
            <Text style={{ color: ink, fontSize: 22 }}>⇄</Text>
          </Pressable>
          {accountSelector('destination')}
        </View>
        {!loading && accounts.length === 0 && (
          <Text style={{ color: muted }}>
            Add two accounts in the same currency to make a transfer.
          </Text>
        )}
        {!loading && !!source && eligible.length === 0 && (
          <Text style={{ color: muted }}>
            No other {source.currencyCode} account. Choose a different source.
          </Text>
        )}
        <View style={{ backgroundColor: surface, borderRadius: 18, padding: 20, gap: 8 }}>
          <Text style={{ color: muted }}>Amount to move</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: accent, fontSize: 24 }}>{source?.currencyCode ?? ''}</Text>
            <TextInput
              accessibilityLabel="Transfer amount"
              editable={!locked}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={muted}
              value={amount}
              onChangeText={setAmount}
              style={{ color: ink, fontSize: 40, flex: 1, padding: 0 }}
            />
          </View>
          {!!amount && !validAmount && (
            <Text style={{ color: theme.colors.warning }}>Enter a positive amount.</Text>
          )}
        </View>
        <FormInput
          accessibilityLabel="Note"
          editable={!locked}
          placeholder="Note (optional)"
          placeholderTextColor={muted}
          value={note}
          onChangeText={setNote}
        />
        {editDate && <QuickAddDate value={date} onChange={setDate} disabled={locked} />}
        <View style={{ backgroundColor: surface, borderRadius: 16, padding: 18, gap: 6 }}>
          <Text style={{ color: muted }}>Review transfer</Text>
          <Text selectable style={{ color: ink, fontSize: 24 }}>
            {amount || '0.00'} {source?.currencyCode ?? ''}
          </Text>
          <Text selectable style={{ color: ink }}>
            {source?.name ?? 'Choose account'} → {destination?.name ?? 'Choose account'}
          </Text>
          {editDate && (
            <Text selectable style={{ color: muted }}>
              {date.toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </Text>
          )}
          {!!note && (
            <Text selectable style={{ color: muted }}>
              Note: {note}
            </Text>
          )}
        </View>
        {error && (
          <Text selectable accessibilityRole="alert" style={{ color: theme.colors.warning }}>
            {error}
          </Text>
        )}
        <FormButton
          label={submitLabel}
          loading={pending}
          disabled={loading || !canSwap || !validAmount}
          onPress={() => void save()}
        />
        {onCancel && (
          <FormButton label="Cancel" variant="secondary" disabled={locked} onPress={onCancel} />
        )}
      </ScrollView>
      <Host>
        <BottomSheet
          isPresented={picker !== null}
          onDismiss={() => setPicker(null)}
          snapPoints={['half', 'full']}
        >
          <Column>
            <NativeText>
              {picker === 'source'
                ? 'Choose source account'
                : `Choose destination · ${source?.currencyCode ?? ''} only`}
            </NativeText>
            {(picker === 'source' ? accounts : eligible).map((account) => (
              <Button
                key={account.id}
                label={`${account.name} · ${account.currencyCode}`}
                onPress={() => choose(picker!, account)}
              />
            ))}
          </Column>
        </BottomSheet>
      </Host>
    </View>
  );
}
