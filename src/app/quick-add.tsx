import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { listAccounts, listCategories, setFavoriteAccount, type Account, type Category } from '@/lib/database';
import { addQuickTransaction } from '@/lib/quick-add-tags';

export default function QuickAdd() {
  const [type, setType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountId, setAccountId] = useState<number>();
  const [categoryId, setCategoryId] = useState<number>();
  const [pending, setPending] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { listAccounts().then((items) => { setAccounts(items); setAccountId(items[0]?.id); }).catch((e) => setError(String(e))); }, []);
  useEffect(() => { listCategories(type).then((items) => { setCategories(items); setCategoryId(items[0]?.id); }).catch((e) => setError(String(e))); }, [type]);
  async function makeFavorite(id: number) {
    setFavoritePending(true); setError(undefined);
    try {
      await setFavoriteAccount(id);
      setAccounts(await listAccounts());
      setAccountId(id);
    } catch (e) { setError(String(e)); } finally { setFavoritePending(false); }
  }
  async function save() {
    const minor = Number(amount) * 100;
    if (!Number.isSafeInteger(minor) || minor <= 0 || !accountId || !categoryId) {
      setError('Enter a valid amount and select an account and category.'); return;
    }
    setPending(true); setError(undefined);
    try {
      await addQuickTransaction({ type, amountMinor: minor, accountId, categoryId, note: note.trim() || null }, tags);
      Alert.alert('Saved', 'Add another transaction?', [
        { text: 'Done', onPress: () => router.back() },
        { text: 'Add another', onPress: () => {
          setAmount(''); setNote(''); setTags('');
          listCategories(type).then(setCategories).catch((e) => setError(String(e)));
        } },
      ]);
    } catch (e) { setError(String(e)); } finally { setPending(false); }
  }
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18 }}>
    <View style={{ flexDirection: 'row', gap: 12 }}>{(['EXPENSE', 'INCOME'] as const).map((value) =>
      <Pressable accessibilityRole="button" key={value} onPress={() => setType(value)} style={{ padding: 12, backgroundColor: type === value ? '#315fcb' : '#e8eaf0', borderRadius: 10 }}><Text style={{ color: type === value ? 'white' : 'black' }}>{value}</Text></Pressable>)}</View>
    <TextInput autoFocus keyboardType="decimal-pad" placeholder="Amount" value={amount} onChangeText={setAmount} style={{ fontSize: 36, padding: 12, borderBottomWidth: 1 }} />
    <Text>Account</Text><View style={{ gap: 8 }}>{accounts.map((account) =>
      <View key={account.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: accountId === account.id }} onPress={() => setAccountId(account.id)} style={{ flex: 1, padding: 12, backgroundColor: accountId === account.id ? '#adc4ff' : '#e8eaf0', borderRadius: 10 }}><Text>{account.name} · {account.currencyCode}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Set ${account.name} as favorite account`} disabled={favoritePending || !!account.isFavorite} onPress={() => makeFavorite(account.id)} style={{ padding: 12 }}><Text>{account.isFavorite ? '★ Favorite' : '☆ Favorite'}</Text></Pressable>
      </View>)}</View>
    <Text>Category</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{categories.map((category) =>
      <Pressable key={category.id} onPress={() => setCategoryId(category.id)} style={{ padding: 12, backgroundColor: categoryId === category.id ? '#adc4ff' : '#e8eaf0', borderRadius: 10 }}><Text>{category.name}</Text></Pressable>)}</View>
    <TextInput placeholder="Note (optional)" value={note} onChangeText={setNote} style={{ padding: 12, borderBottomWidth: 1 }} />
    <TextInput accessibilityLabel="Tags, separated by commas" placeholder="Tags (optional, comma-separated)" value={tags} onChangeText={setTags} style={{ padding: 12, borderBottomWidth: 1 }} />
    {error && <Text selectable accessibilityRole="alert" style={{ color: '#b00020' }}>{error}</Text>}
    <Pressable accessibilityRole="button" disabled={pending} onPress={save} style={{ padding: 18, backgroundColor: '#315fcb', borderRadius: 12 }}><Text style={{ color: 'white' }}>{pending ? 'Saving…' : 'Save'}</Text></Pressable>
  </ScrollView>;
}
