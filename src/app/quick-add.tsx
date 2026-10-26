import { useEffect, useState } from 'react';
import { router, Stack } from 'expo-router';
import { Alert, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { listAccounts, listCategories, setFavoriteAccount, type Account, type Category } from '@/lib/database';
import { addQuickTransaction } from '@/lib/quick-add-tags';
import { QuickAddDate } from '@/components/quick-add-date';
import { QuickAddCategory } from '@/components/quick-add-category';
import { listManagedCategories, type ManagedCategory } from '@/lib/categories';

import { theme } from '@/theme';
import { FormButton, FormInput, JoinedChoice } from '@/components/form-controls';

const { text: ink, muted, surface: panel, accent, line: divider } = theme.colors;
type Kind = 'EXPENSE' | 'INCOME';
type Chooser = 'account' | 'category' | null;

function Label({ children }: { children: string }) {
  return <Text style={{ color: muted, fontSize: 12 }}>{children}</Text>;
}

function HeaderAction({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8, opacity: pressed ? 0.6 : 1 })}><Text style={{ color: accent, fontSize: 16 }}>{label}</Text></Pressable>;
}

export default function QuickAdd() {
  const [type, setType] = useState<Kind>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountId, setAccountId] = useState<number>();
  const [categoryId, setCategoryId] = useState<number>();
  const [chooser, setChooser] = useState<Chooser>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  const [error, setError] = useState<string>();
  const [date, setDate] = useState(() => new Date());
  const [managedCategories, setManagedCategories] = useState<ManagedCategory[]>([]);

  useEffect(() => {
    let active = true;
    listAccounts().then((items) => {
      if (!active) return;
      setAccounts(items);
      setAccountId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id);
    }).catch((e) => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setCategories([]);
    setCategoryId(undefined);
    listCategories(type).then((items) => {
      if (!active) return;
      setCategories(items);
      setCategoryId(items[0]?.id);
    }).catch((e) => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [type]);

  useEffect(() => {
    if (!categories.length) return;
    let active = true;
    listManagedCategories().then((items) => { if (active) setManagedCategories(items); })
      .catch((e) => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [categories]);

  const account = accounts.find((item) => item.id === accountId);
  const search = query.trim().toLocaleLowerCase();
  const byId = new Map(managedCategories.map((item) => [item.id, item]));
  const categoryPath = (id: number) => {
    const names: string[] = [];
    const seen = new Set<number>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id); names.unshift(current.name);
      current = current.parentId == null ? undefined : byId.get(current.parentId);
    }
    return names.join(' › ') || categories.find((item) => item.id === id)?.name || '';
  };
  const close = () => { setChooser(null); setQuery(''); };
  const open = (target: Exclude<Chooser, null>) => { setError(undefined); setQuery(''); setChooser(target); };

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
      await addQuickTransaction({ type, amountMinor: minor, accountId, categoryId, date, note: note.trim() || null }, tags);
      Alert.alert('Saved', 'Add another transaction?', [
        { text: 'Done', onPress: () => router.back() },
        { text: 'Add another', onPress: () => {
          setAmount(''); setNote(''); setTags('');
          listCategories(type).then(setCategories).catch((e) => setError(String(e)));
        } },
      ]);
    } catch (e) { setError(String(e)); } finally { setPending(false); }
  }

  return <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
    <Stack.Screen options={{ title: chooser === 'account' ? 'All accounts' : chooser === 'category' ? 'All categories' : 'Quick add', headerStyle: { backgroundColor: theme.colors.background }, headerTintColor: ink,
      headerLeft: chooser ? undefined : () => <HeaderAction label="Cancel" onPress={() => router.back()} />,
      headerRight: chooser ? undefined : () => <HeaderAction label="Transfer" onPress={() => router.replace('/transfer')} /> }} />
    {chooser ? <View style={{ flex: 1, paddingHorizontal: 22, paddingTop: 16, gap: 12 }}>
      <Pressable accessibilityRole="button" onPress={close} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: accent }}>Back to quick add</Text></Pressable>
      <TextInput accessibilityLabel={chooser === 'account' ? 'Search accounts' : 'Search categories'} placeholder={chooser === 'account' ? 'Search accounts' : 'Search categories'} placeholderTextColor={muted} value={query} onChangeText={setQuery} autoFocus style={{ color: ink, backgroundColor: panel, borderRadius: 14, paddingHorizontal: 16, minHeight: 52, fontSize: 16 }} />
      <FlatList<Account | Category> keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" data={chooser === 'account' ? accounts.filter((item) => `${item.name} ${item.currencyCode}`.toLocaleLowerCase().includes(search)) : categories.filter((item) => categoryPath(item.id).toLocaleLowerCase().includes(search))} keyExtractor={(item) => String(item.id)} contentContainerStyle={{ paddingBottom: 32 }} ListEmptyComponent={<Text style={{ color: muted, paddingVertical: 20 }}>{search ? 'No matches' : chooser === 'account' ? 'No accounts available' : `No ${type.toLowerCase()} categories available`}</Text>} renderItem={({ item }) => {
        const isAccount = chooser === 'account';
        const selected = isAccount ? accountId === item.id : categoryId === item.id;
        return <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: divider }}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { if (isAccount) setAccountId(item.id); else setCategoryId(item.id); close(); }} style={{ flex: 1, minHeight: 58, justifyContent: 'center', paddingHorizontal: 12 }}>
            <Text style={{ color: selected ? accent : ink, fontSize: 16 }}>{isAccount ? item.name : categoryPath(item.id)}{isAccount ? ` · ${(item as Account).currencyCode}${(item as Account).isFavorite ? ' · Favorite' : ''}` : ''}{selected ? '  ✓' : ''}</Text>
          </Pressable>
          {isAccount && <Pressable accessibilityRole="button" accessibilityLabel={`Set ${item.name} as favorite account`} disabled={favoritePending || !!(item as Account).isFavorite} onPress={() => void makeFavorite(item.id)} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 }}><Text style={{ color: accent }}>{(item as Account).isFavorite ? '★' : '☆ Favorite'}</Text></Pressable>}
        </View>;
      }} />
      {error && <Text selectable accessibilityRole="alert" style={{ color: theme.colors.warning }}>{error}</Text>}
    </View> : <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingBottom: 48, gap: 18 }}>
      <View style={{ gap: 6 }}><Label>{`Amount · ${account?.currencyCode ?? 'Select account'}`}</Label><View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: divider }}><Text style={{ color: ink, fontSize: 48, fontWeight: '300' }}>{account?.currencyCode === 'BDT' ? '৳' : account?.currencyCode === 'USD' ? '$' : ''}</Text><TextInput accessibilityLabel="Amount" autoFocus keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={muted} value={amount} onChangeText={setAmount} style={{ flex: 1, color: ink, fontSize: 48, fontWeight: '300', fontVariant: ['tabular-nums'] }} /></View></View>
      <JoinedChoice value={type} options={[{ value: 'EXPENSE', label: 'Expense' }, { value: 'INCOME', label: 'Income' }]} onChange={(value) => { setType(value as Kind); setError(undefined); }} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Choose account${account ? `, currently ${account.name}, ${account.currencyCode}` : ''}`} onPress={() => open('account')} style={{ backgroundColor: panel, padding: 18, borderRadius: 18, gap: 6 }}><Label>Account</Label><Text selectable style={{ color: ink, fontSize: 18, fontWeight: '600' }}>{account ? `${account.name} · ${account.currencyCode}${account.isFavorite ? ' · Favorite' : ''}` : loading ? 'Loading…' : 'Choose an account'}</Text></Pressable>
      <QuickAddCategory key={type} categories={managedCategories.filter((item) => item.type === type)} orderedIds={categories.map((item) => item.id)} selectedId={categoryId} onSelect={setCategoryId} onOpenAll={() => open('category')} />
      <View style={{ gap: 12 }}><Label>Note · optional</Label><FormInput accessibilityLabel="Note" placeholder="Add a note" placeholderTextColor={muted} value={note} onChangeText={setNote} /><Label>Tags · optional</Label><FormInput accessibilityLabel="Tags, separated by commas" placeholder="Comma-separated tags" placeholderTextColor={muted} value={tags} onChangeText={setTags} /><QuickAddDate value={date} onChange={setDate} /></View>
      {error && <Text selectable accessibilityRole="alert" style={{ color: theme.colors.warning }}>{error}</Text>}
      <FormButton label="Save" loading={pending} onPress={() => void save()} />
    </ScrollView>}
  </View>;
}
