import { FormButton, FormInput } from '@/components/form-controls';
import { useCallback, useEffect, useRef, useState } from 'react';
import { theme } from '@/theme';
import { TransactionReceipt } from '@/components/transaction-receipt';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { Host, Switch } from '@expo/ui';
import { ActivityIndicator, Alert, BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
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
  const [dirty, setDirty] = useState(false);
  const navigation = useNavigation();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const onSavingChange = useCallback((value: boolean) => { savingRef.current = value; setSaving(value); }, []);
  const exitEditing = useCallback(() => {
    setEditing(false);
    setDirty(false);
    setState('loading');
    setTransaction(null);
    setRevision((value) => value + 1);
  }, []);
  const confirming = useRef(false);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const confirmDiscard = useCallback((discard: () => void) => {
    if (savingRef.current || confirming.current) return;
    if (!dirty) { setDirty(false); discard(); return; }
    confirming.current = true;
    Alert.alert('Discard changes?', 'Your unsaved edits will be lost.', [
      { text: 'Keep editing', style: 'cancel', onPress: () => { confirming.current = false; } },
      { text: 'Discard', style: 'destructive', onPress: () => { confirming.current = false; setDirty(false); discard(); } },
    ], { cancelable: false, onDismiss: () => { confirming.current = false; } });
  }, [dirty]);
  usePreventRemove(editing && (dirty || saving), ({ data }) => {
    confirmDiscard(() => {
      pendingNavigation.current = () => navigation.dispatch(data.action);
      setEditing(false);
    });
  });
  useEffect(() => {
    if (!editing && pendingNavigation.current) {
      const resume = pendingNavigation.current;
      pendingNavigation.current = null;
      resume();
    }
  }, [editing]);
  useEffect(() => {
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
  }, [id, revision]);
  useEffect(() => {
    if (!editing) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { confirmDiscard(exitEditing); return true; });
    return () => subscription.remove();
  }, [editing, confirmDiscard, exitEditing]);
  return <View style={{ flex: 1 }}>
    <Stack.Screen options={{ title: editing ? 'Edit transaction' : 'Receipt',
      headerStyle: { backgroundColor: theme.colors.background },
      headerTintColor: theme.colors.text,
      gestureEnabled: !editing,
      headerLeft: editing ? () => <Pressable accessibilityRole="button" disabled={saving} accessibilityState={{ disabled: saving }} onPress={() => confirmDiscard(exitEditing)} style={{ paddingVertical: 12 }}><Text style={{ color: theme.colors.accent }}>Cancel</Text></Pressable> : undefined,
      headerRight: !editing && state === 'ready' ? () => <Pressable accessibilityRole="button" onPress={() => setEditing(true)}><Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: '600' }}>Edit</Text></Pressable> : undefined }} />
    {editing && transaction ? <EditTransactionScreen transaction={transaction} onDirtyChange={setDirty} onSavingChange={onSavingChange} onCancel={() => confirmDiscard(exitEditing)} onSaved={async () => {
      const refreshed = await loadEditableTransaction(transaction.id);
      if (!refreshed) throw new Error('Transaction not found after saving');
      setTransaction(refreshed);
      setDirty(false);
      setEditing(false);
    }} /> : state === 'ready' && transaction ? <TransactionReceipt key={transaction.id} transaction={transaction} /> :
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: theme.colors.background }}>
        {state === 'loading' ? <ActivityIndicator accessibilityLabel="Loading receipt" /> : <>
          <Text selectable accessibilityRole="alert" style={{ color: theme.colors.text, textAlign: 'center' }}>{state === 'error' ? error : 'Transaction not found or cannot be viewed here.'}</Text>
          {state === 'error' && <Pressable accessibilityRole="button" onPress={() => setRevision((value) => value + 1)} style={{ padding: 16 }}><Text style={{ color: theme.colors.accent }}>Retry</Text></Pressable>}
        </>}
      </View>}
  </View>;
}

function EditTransactionScreen({ transaction, onDirtyChange, onSavingChange, onCancel, onSaved }: { transaction: EditableTransaction; onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState(transaction.note ?? '');
  const initialTags = transaction.tags.map((tag) => tag.name).join(', ');
  const initialItems = transaction.lineItems.map((item) => ({ id: item.id, name: item.name, amount: formatLineItemAmount(item.amountMinor), quantity: item.quantity?.toString() ?? '' }));
  const [tags, setTags] = useState(initialTags);
  const [excluded, setExcluded] = useState(transaction.excludeFromReport !== 0);
  const [items, setItems] = useState<{ id?: number; name: string; amount: string; quantity: string }[]>(initialItems);
  const [saving, setSaving] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    onDirtyChange(!committed && (note !== (transaction.note ?? '') || tags !== initialTags || excluded !== (transaction.excludeFromReport !== 0) || JSON.stringify(items) !== JSON.stringify(initialItems)));
  }, [note, tags, excluded, items, transaction, committed, onDirtyChange]);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    onSavingChange(true);
    setError(undefined);
    try {
      const lineItems: LineItem[] = items.map((item) => {
        const amountMinor = parseLineItemAmount(item.amount);
        const quantity = item.quantity.trim() === '' ? null : Number(item.quantity.trim());
        return { id: item.id, name: item.name, amountMinor, quantity };
      });
      if (!committed) {
        await saveTransactionEdit(transaction, note, excluded, tags, lineItems);
        setCommitted(true);
      }
      await onSaved();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  };
  const labelStyle = { color: theme.colors.text, fontSize: theme.type.body, fontWeight: '600' as const };
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
    style={{ backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 20 }}>
    <>
      <View style={{ gap: 8, padding: 16, borderRadius: theme.radius.group, backgroundColor: theme.colors.surface }}>
        <Text selectable style={{ color: theme.colors.text, fontSize: 24, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{formatTransactionAmount(transaction.type, transaction.amountMinor, transaction.currencyCode)}</Text>
        <Text selectable style={{ color: theme.colors.text }}>{transaction.categoryName ?? transaction.type} · {transaction.accountName}</Text>
        <Text selectable style={{ color: theme.colors.muted }}>{formatEpochDay(transaction.date)} · Financial details are read-only</Text>
      </View>
      <View style={{ gap: 8 }}>
        <Text style={labelStyle}>Note</Text>
        <FormInput accessibilityLabel="Note" multiline value={note} onChangeText={setNote} editable={!saving && !committed}
          placeholder="Optional note" style={{ minHeight: 100, textAlignVertical: 'top' }} />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={labelStyle}>Tags</Text>
        <FormInput accessibilityLabel="Tags" value={tags} onChangeText={setTags} editable={!saving && !committed}
          placeholder="Comma-separated tags" autoCapitalize="words"
          />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={labelStyle}>Line items <Text style={{ color: theme.colors.muted, fontWeight: '400' }}>(optional)</Text></Text>
        <Text selectable style={{ color: theme.colors.muted, lineHeight: 20 }}>Transaction amount stays unchanged. Line items do not need to add up to it. Amounts can be positive, negative or zero.</Text>
        {items.map((item, index) => <View key={item.id ?? `new-${index}`} style={{ gap: 10, padding: 12, backgroundColor: theme.colors.surface, borderRadius: theme.radius.group }}>
          <Text style={{ color: theme.colors.muted }}>Line item {index + 1}</Text>
          <FormInput accessibilityLabel={`Line item ${index + 1} name`} placeholder="Name" value={item.name} editable={!saving && !committed}
            onChangeText={(name) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, name } : entry))} />
          <FormInput accessibilityLabel={`Line item ${index + 1} amount`} placeholder="Amount (major units)" value={item.amount} editable={!saving && !committed}
            keyboardType="numbers-and-punctuation" onChangeText={(amount) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, amount } : entry))} />
          <FormInput accessibilityLabel={`Line item ${index + 1} quantity`} placeholder="Quantity (optional)" value={item.quantity} editable={!saving && !committed}
            keyboardType="decimal-pad" onChangeText={(quantity) => setItems((current) => current.map((entry, i) => i === index ? { ...entry, quantity } : entry))} />
          <FormButton label="Remove line item" accessibilityLabel={`Remove line item ${index + 1}`} variant="danger" disabled={saving || committed} onPress={() => setItems((current) => current.filter((_, i) => i !== index))} />
        </View>)}
        <FormButton label="Add line item" variant="secondary" disabled={saving || committed} onPress={() => setItems((current) => [...current, { name: '', amount: '', quantity: '' }])} />
      </View>
      <Host colorScheme="dark" style={{ width: '100%', height: 56 }}>
        <Switch label="Exclude from reports" value={excluded} onValueChange={setExcluded} disabled={saving || committed} />
      </Host>
      {error && <Text accessibilityRole="alert" selectable style={{ color: theme.colors.warning }}>{error}</Text>}
      <FormButton label={saving ? 'Saving…' : committed ? 'Retry receipt' : 'Save changes'} loading={saving} onPress={() => void save()} />
      <FormButton label="Cancel" variant="secondary" disabled={saving} onPress={onCancel} />
    </>
  </ScrollView>;
}
