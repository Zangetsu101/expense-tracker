import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { listAccounts, type Account } from '@/lib/database';
import { addTransfer, transferAmountMinor } from '@/lib/transfers';

export default function TransferScreen() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fromId, setFromId] = useState<number>();
  const [toId, setToId] = useState<number>();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    listAccounts().then((items) => { setAccounts(items); setFromId(items[0]?.id); })
      .catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, []);
  const source = accounts.find((account) => account.id === fromId);
  const destinations = accounts.filter((account) => account.id !== fromId && account.currencyCode === source?.currencyCode);

  async function save() {
    try {
      const amountMinor = transferAmountMinor(amount);
      if (!fromId || !toId) throw new Error('Select two different accounts with the same currency.');
      setPending(true);
      setError(undefined);
      await addTransfer({ amountMinor, fromAccountId: fromId, toAccountId: toId, note });
      router.back();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  }

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18 }}>
    <TextInput autoFocus keyboardType="decimal-pad" placeholder="Amount" accessibilityLabel="Transfer amount" value={amount} onChangeText={setAmount} style={{ fontSize: 36, padding: 12, borderBottomWidth: 1 }} />
    <Text>From account</Text>
    {accounts.map((account) => <Pressable key={account.id} accessibilityRole="button" accessibilityState={{ selected: fromId === account.id }} onPress={() => { setFromId(account.id); setToId(undefined); }} style={{ padding: 12, borderRadius: 10, backgroundColor: fromId === account.id ? '#adc4ff' : '#e8eaf0' }}><Text>{account.name} · {account.currencyCode}</Text></Pressable>)}
    <Text>To account</Text>
    {destinations.map((account) => <Pressable key={account.id} accessibilityRole="button" accessibilityState={{ selected: toId === account.id }} onPress={() => setToId(account.id)} style={{ padding: 12, borderRadius: 10, backgroundColor: toId === account.id ? '#adc4ff' : '#e8eaf0' }}><Text>{account.name} · {account.currencyCode}</Text></Pressable>)}
    {!loading && destinations.length === 0 && <Text selectable>Add another account in the same currency to make a transfer.</Text>}
    <TextInput placeholder="Note (optional)" value={note} onChangeText={setNote} style={{ padding: 12, borderBottomWidth: 1 }} />
    {error && <Text selectable accessibilityRole="alert" style={{ color: '#b00020' }}>{error}</Text>}
    <Pressable accessibilityRole="button" disabled={loading || pending || !toId} onPress={() => void save()} style={{ padding: 18, borderRadius: 12, backgroundColor: '#315fcb', opacity: loading || pending || !toId ? 0.5 : 1 }}><Text style={{ color: 'white' }}>{pending ? 'Saving…' : 'Save transfer'}</Text></Pressable>
  </ScrollView>;
}
