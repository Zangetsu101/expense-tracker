import { useEffect, useState } from 'react';
import { BottomSheet, Button, Column, Host, Text as NativeText } from '@expo/ui';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { listAccounts, type Account } from '@/lib/database';
import { addTransfer, transferAmountMinor } from '@/lib/transfers';

import { theme } from '@/theme';
import { FormButton, FormInput } from '@/components/form-controls';

type Side = 'source' | 'destination';
const { text: ink, muted, surface, accent } = theme.colors;

export default function TransferScreen() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fromId, setFromId] = useState<number>();
  const [toId, setToId] = useState<number>();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [picker, setPicker] = useState<Side | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    listAccounts().then((items) => { setAccounts(items); setFromId(items[0]?.id); })
      .catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, []);
  const source = accounts.find((account) => account.id === fromId);
  const destination = accounts.find((account) => account.id === toId);
  const eligible = accounts.filter((account) => account.id !== fromId && account.currencyCode === source?.currencyCode);
  const canSwap = !!source && !!destination && source.id !== destination.id && source.currencyCode === destination.currencyCode;
  let validAmount = false;
  try { transferAmountMinor(amount); validAmount = true; } catch {}

  function choose(side: Side, account: Account) {
    if (side === 'source') {
      setFromId(account.id);
      if (account.id === toId || account.currencyCode !== destination?.currencyCode) setToId(undefined);
    } else if (account.id !== fromId && account.currencyCode === source?.currencyCode) setToId(account.id);
    setPicker(null);
    setError(undefined);
  }

  async function save() {
    if (pending) return;
    try {
      const amountMinor = transferAmountMinor(amount);
      if (!source || !destination || source.id === destination.id || source.currencyCode !== destination.currencyCode) throw new Error('Select two different accounts with the same currency.');
      setPending(true);
      setError(undefined);
      await addTransfer({ amountMinor, fromAccountId: source.id, toAccountId: destination.id, note });
      router.back();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  }

  function accountSelector(side: Side) {
    const account = side === 'source' ? source : destination;
    const label = side === 'source' ? 'From' : 'To';
    return <Pressable accessibilityRole="button" accessibilityLabel={`${label} account: ${account ? `${account.name}, ${account.currencyCode}` : 'Not selected'}`} accessibilityHint="Opens account chooser" disabled={loading || pending} onPress={() => setPicker(side)} style={{ flex: 1, minWidth: 0, minHeight: 88, backgroundColor: surface, borderRadius: 16, padding: 10, gap: 2, borderWidth: 1, borderColor: theme.colors.line }}>
      <Text style={{ color: muted, fontSize: 13 }} accessible={false}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}><Text numberOfLines={2} accessible={false} style={{ color: ink, fontSize: 16, lineHeight: 20, flex: 1, minWidth: 0 }}>{account?.name ?? 'Choose account'}</Text><Text style={{ color: ink, fontSize: 18 }} accessible={false}>›</Text></View>
      <Text numberOfLines={1} accessible={false} style={{ color: muted }}>{account?.currencyCode ?? (source ? `Select a ${source.currencyCode} account` : 'Select a source first')}</Text>
    </Pressable>;
  }

  return <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 20 }}>
      <Text style={{ color: muted }}>Move money between your accounts.</Text>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        {accountSelector('source')}
        <Pressable accessibilityRole="button" accessibilityLabel="Swap accounts" accessibilityState={{ disabled: !canSwap || pending }} disabled={!canSwap || pending} onPress={() => { setFromId(destination!.id); setToId(source!.id); setError(undefined); }} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.raised, alignItems: 'center', justifyContent: 'center', opacity: canSwap && !pending ? 1 : 0.5 }}><Text style={{ color: ink, fontSize: 22 }}>⇄</Text></Pressable>
        {accountSelector('destination')}
      </View>
      {!loading && accounts.length === 0 && <Text style={{ color: muted }}>Add two accounts in the same currency to make a transfer.</Text>}
      {!loading && !!source && eligible.length === 0 && <Text style={{ color: muted }}>No other {source.currencyCode} account. Choose a different source.</Text>}
      <View style={{ backgroundColor: surface, borderRadius: 18, padding: 20, gap: 8 }}>
        <Text style={{ color: muted }}>Amount to move</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ color: accent, fontSize: 24 }}>{source?.currencyCode ?? ''}</Text><TextInput accessibilityLabel="Transfer amount" editable={!pending} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={muted} value={amount} onChangeText={setAmount} style={{ color: ink, fontSize: 40, flex: 1, padding: 0 }} /></View>
        {!!amount && !validAmount && <Text style={{ color: theme.colors.warning }}>Enter a positive amount.</Text>}
      </View>
      <FormInput accessibilityLabel="Note" editable={!pending} placeholder="Note (optional)" placeholderTextColor={muted} value={note} onChangeText={setNote} />
      <View style={{ backgroundColor: surface, borderRadius: 16, padding: 18, gap: 6 }}>
        <Text style={{ color: muted }}>Review transfer</Text>
        <Text selectable style={{ color: ink, fontSize: 24 }}>{amount || '0.00'} {source?.currencyCode ?? ''}</Text>
        <Text selectable style={{ color: ink }}>{source?.name ?? 'Choose account'} → {destination?.name ?? 'Choose account'}</Text>
        {!!note && <Text selectable style={{ color: muted }}>Note: {note}</Text>}
      </View>
      {error && <Text selectable accessibilityRole="alert" style={{ color: theme.colors.warning }}>{error}</Text>}
      <FormButton label="Save transfer" loading={pending} disabled={loading || !canSwap || !validAmount} onPress={() => void save()} />
    </ScrollView>
    <Host><BottomSheet isPresented={picker !== null} onDismiss={() => setPicker(null)} snapPoints={['half', 'full']}><Column>
      <NativeText>{picker === 'source' ? 'Choose source account' : `Choose destination · ${source?.currencyCode ?? ''} only`}</NativeText>
      {(picker === 'source' ? accounts : eligible).map((account) => <Button key={account.id} label={`${account.name} · ${account.currencyCode}`} onPress={() => choose(picker!, account)} />)}
    </Column></BottomSheet></Host>
  </View>;
}
