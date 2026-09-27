import { useEffect, useState } from 'react';
import { TransactionReceipt } from '@/components/transaction-receipt';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Host, Switch } from '@expo/ui';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { loadEditableTransaction, saveTransactionEdit, type EditableTransaction, type LineItem } from '@/lib/transaction-edit';
import { formatEpochDay, formatTransactionAmount } from '@/lib/transaction-format';
import { formatLineItemAmount, parseLineItemAmount } from '@/lib/line-item-amount';

type LoadState = 'loading' | 'missing' | 'ready' | 'error';

export default function TransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [editing, setEditing] = useState(false);
  const [transaction, setTransaction] = useState<EditableTransaction | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (editing) return;
    let active = true;
    setState('loading');
    setTransaction(null);
    const transactionId = Number(id);
    if (!id || !Number.isSafeInteger(transactionId) || transactionId <= 0) {
      setState('missing');
      return () => { active = false; };
    }
    loadEditableTransaction(transactionId).then((row) => {
      if (!active) return;
      setTransaction(row);
      setState(row ? 'ready' : 'missing');
    }).catch((cause) => { if (active) { setError(String(cause)); setState('error'); } });
    return () => { active = false; };
  }, [id, editing, revision]);
  useEffect(() => {
    if (!editing) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setEditing(false); return true; });
    return () => subscription.remove();
  }, [editing]);
  return <View style={{ flex: 1 }}>
    <Stack.Screen options={{ title: editing ? 'Edit transaction' : 'Receipt',
      headerStyle: editing ? undefined : { backgroundColor: '#101820' },
      headerTintColor: editing ? undefined : '#f1f5f4',
      headerLeft: editing ? () => <Pressable accessibilityRole="button" onPress={() => setEditing(false)}><Text>Receipt</Text></Pressable> : undefined,
      headerRight: !editing && state === 'ready' ? () => <Pressable accessibilityRole="button" onPress={() => setEditing(true)}><Text style={{ color: '#8be0be', fontSize: 16, fontWeight: '600' }}>Edit</Text></Pressable> : undefined }} />
    {editing ? <EditTransactionScreen /> : state === 'ready' && transaction ? <TransactionReceipt key={transaction.id} transaction={transaction} /> :
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#101820' }}>
        {state === 'loading' ? <ActivityIndicator accessibilityLabel="Loading receipt" /> : <>
          <Text selectable accessibilityRole="alert" style={{ color: '#f1f5f4', textAlign: 'center' }}>{state === 'error' ? error : 'Transaction not found or cannot be viewed here.'}</Text>
          {state === 'error' && <Pressable accessibilityRole="button" onPress={() => setRevision((value) => value + 1)} style={{ padding: 16 }}><Text style={{ color: '#8be0be' }}>Retry</Text></Pressable>}
        </>}
      </View>}
  </View>;
}

function EditTransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [transaction, setTransaction] = useState<EditableTransaction | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [excluded, setExcluded] = useState(false);
  const [items, setItems] = useState<{ id?: number; name: string; amount: string; quantity: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    setState('loading');
    const transactionId = Number(id);
    if (!id || !Number.isSafeInteger(transactionId) || transactionId <= 0) {
      setState('missing');
      return () => { active = false; };
    }
    loadEditableTransaction(transactionId).then((row) => {
      if (!active) return;
      if (!row) { setState('missing'); return; }
      setTransaction(row);
      setNote(row.note ?? '');
      setTags(row.tags.map((tag) => tag.name).join(', '));
      setExcluded(row.excludeFromReport !== 0);
      setItems(row.lineItems.map((item) => ({ id: item.id, name: item.name, amount: formatLineItemAmount(item.amountMinor), quantity: item.quantity?.toString() ?? '' })));
      setState('ready');
    }).catch((cause) => { if (active) { setError(String(cause)); setState('error'); } });
    return () => { active = false; };
  }, [id]);
  const save = async () => {
    if (!transaction || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const lineItems: LineItem[] = items.map((item) => {
        const amountMinor = parseLineItemAmount(item.amount);
        const quantity = item.quantity.trim() === '' ? null : Number(item.quantity.trim());
        return { id: item.id, name: item.name, amountMinor, quantity };
      });
      await saveTransactionEdit(transaction, note, excluded, tags, lineItems);
      router.back();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
    style={{ backgroundColor: '#f6f6f8' }} contentContainerStyle={{ padding: 20, gap: 18 }}>
    {state === 'loading' && <ActivityIndicator accessibilityLabel="Loading transaction" />}
    {state === 'missing' && <Text accessibilityRole="alert">Transaction not found or cannot be edited here.</Text>}
    {state === 'error' && <Text accessibilityRole="alert" selectable>{error}</Text>}
    {state === 'ready' && transaction && <>
      <Text selectable style={{ fontSize: 18, fontWeight: '600' }}>{transaction.categoryName ?? transaction.type} · {transaction.accountName}</Text>
      <Text selectable>{formatTransactionAmount(transaction.type, transaction.amountMinor, transaction.currencyCode)} · {formatEpochDay(transaction.date)}</Text>
      <View style={{ gap: 8 }}>
        <Text>Note</Text>
        <TextInput accessibilityLabel="Note" multiline value={note} onChangeText={setNote} editable={!saving}
          placeholder="Optional note" style={{ backgroundColor: 'white', minHeight: 100, padding: 12, borderRadius: 10, textAlignVertical: 'top' }} />
      </View>
      <View style={{ gap: 8 }}>
        <Text>Tags</Text>
        <TextInput accessibilityLabel="Tags" value={tags} onChangeText={setTags} editable={!saving}
          placeholder="Comma-separated tags" autoCapitalize="words"
          style={{ backgroundColor: 'white', padding: 12, borderRadius: 10 }} />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 17, fontWeight: '600' }}>Line items (optional)</Text>
        <Text selectable>Transaction amount stays unchanged. Line items do not need to add up to it.</Text>
        {items.map((item, index) => <View key={item.id ?? `new-${index}`} style={{ gap: 8, padding: 12, backgroundColor: 'white', borderRadius: 10 }}>
          <TextInput accessibilityLabel={`Line item ${index + 1} name`} placeholder="Name" value={item.name} editable={!saving}
            onChangeText={(name) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, name } : entry))} />
          <TextInput accessibilityLabel={`Line item ${index + 1} amount`} placeholder="Amount (major units)" value={item.amount} editable={!saving}
            keyboardType="decimal-pad" onChangeText={(amount) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, amount } : entry))} />
          <TextInput accessibilityLabel={`Line item ${index + 1} quantity`} placeholder="Quantity (optional)" value={item.quantity} editable={!saving}
            keyboardType="decimal-pad" onChangeText={(quantity) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, quantity } : entry))} />
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => setItems((current) => current.filter((_, i) => i !== index))}>
            <Text style={{ color: '#b33' }}>Remove line item</Text>
          </Pressable>
        </View>)}
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => setItems((current) => [...current, { name: '', amount: '', quantity: '' }])}>
          <Text style={{ color: '#315fcb' }}>Add line item</Text>
        </Pressable>
      </View>
      <Host style={{ width: '100%', height: 56 }}>
        <Switch label="Exclude from reports" value={excluded} onValueChange={setExcluded} disabled={saving} />
      </Host>
      {error && <Text accessibilityRole="alert" selectable>{error}</Text>}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void save()}
        style={{ backgroundColor: '#315fcb', padding: 14, borderRadius: 10, alignItems: 'center' }}>
        <Text style={{ color: 'white', fontWeight: '600' }}>{saving ? 'Saving…' : 'Save'}</Text>
      </Pressable>
    </>}
  </ScrollView>;
}
