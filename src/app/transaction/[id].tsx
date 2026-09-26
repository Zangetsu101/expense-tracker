import { useEffect, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Host, Switch } from '@expo/ui';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { loadEditableTransaction, saveTransactionEdit, type EditableTransaction } from '@/lib/transaction-edit';

type LoadState = 'loading' | 'missing' | 'ready' | 'error';

export default function EditTransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [transaction, setTransaction] = useState<EditableTransaction | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [note, setNote] = useState('');
  const [excluded, setExcluded] = useState(false);
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
      setExcluded(row.excludeFromReport !== 0);
      setState('ready');
    }).catch((cause) => { if (active) { setError(String(cause)); setState('error'); } });
    return () => { active = false; };
  }, [id]);
  const save = async () => {
    if (!transaction || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await saveTransactionEdit(transaction, note, excluded);
      router.back();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
    style={{ backgroundColor: '#f6f6f8' }} contentContainerStyle={{ padding: 20, gap: 18 }}>
    <Stack.Screen options={{ title: 'Edit transaction' }} />
    {state === 'loading' && <ActivityIndicator accessibilityLabel="Loading transaction" />}
    {state === 'missing' && <Text accessibilityRole="alert">Transaction not found or cannot be edited here.</Text>}
    {state === 'error' && <Text accessibilityRole="alert" selectable>{error}</Text>}
    {state === 'ready' && transaction && <>
      <Text selectable style={{ fontSize: 18, fontWeight: '600' }}>{transaction.categoryName ?? transaction.type} · {transaction.accountName}</Text>
      <Text selectable>{new Intl.NumberFormat(undefined, { style: 'currency', currency: transaction.currencyCode }).format(transaction.amountMinor / 100)} · {new Date(transaction.date * 86400000).toISOString().slice(0, 10)}</Text>
      <View style={{ gap: 8 }}>
        <Text>Note</Text>
        <TextInput accessibilityLabel="Note" multiline value={note} onChangeText={setNote} editable={!saving}
          placeholder="Optional note" style={{ backgroundColor: 'white', minHeight: 100, padding: 12, borderRadius: 10, textAlignVertical: 'top' }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Host matchContents><Switch label="Exclude from reports" value={excluded} onValueChange={setExcluded} disabled={saving} /></Host>
      </View>
      {error && <Text accessibilityRole="alert" selectable>{error}</Text>}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void save()}
        style={{ backgroundColor: '#315fcb', padding: 14, borderRadius: 10, alignItems: 'center' }}>
        <Text style={{ color: 'white', fontWeight: '600' }}>{saving ? 'Saving…' : 'Save'}</Text>
      </Pressable>
    </>}
  </ScrollView>;
}
