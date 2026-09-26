import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { createAccount, listManagedAccounts, setFavoriteAccount, type ManagedAccount } from '@/lib/accounts';

export default function AccountsScreen() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [name, setName] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try { setAccounts(await listManagedAccounts()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save() {
    setPending(true); setError(undefined);
    try {
      await createAccount({ name, currencyCode, openingBalance });
      setName(''); setCurrencyCode(''); setOpeningBalance('0');
      await load();
    } catch (e) { setError(String(e)); }
    finally { setPending(false); }
  }
  async function makeFavorite(id: number) {
    setPending(true); setError(undefined);
    try { await setFavoriteAccount(id); await load(); }
    catch (e) { setError(String(e)); }
    finally { setPending(false); }
  }
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
    <Text style={{ fontSize: 18, fontWeight: '600' }}>New account</Text>
    <TextInput accessibilityLabel="Account name" placeholder="Account name" value={name} onChangeText={setName} maxLength={100} style={{ padding: 12, borderBottomWidth: 1 }} />
    <TextInput accessibilityLabel="Currency code" placeholder="Currency (e.g. BDT)" value={currencyCode} onChangeText={setCurrencyCode} autoCapitalize="characters" maxLength={3} style={{ padding: 12, borderBottomWidth: 1 }} />
    <TextInput accessibilityLabel="Opening balance" placeholder="Opening balance" value={openingBalance} onChangeText={setOpeningBalance} keyboardType="decimal-pad" style={{ padding: 12, borderBottomWidth: 1 }} />
    <Text>Currency is fixed after creation. Opening balance may be negative.</Text>
    <Pressable accessibilityRole="button" disabled={pending} onPress={() => void save()} style={{ padding: 16, backgroundColor: '#315fcb', borderRadius: 12 }}><Text style={{ color: 'white', fontWeight: '600' }}>{pending ? 'Saving…' : 'Create account'}</Text></Pressable>
    {error && <Text selectable accessibilityRole="alert" style={{ color: '#b00020' }}>{error}</Text>}
    {loading ? <ActivityIndicator /> : <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 18, fontWeight: '600' }}>Accounts</Text>
      {accounts.length === 0 && !error && <Text>No accounts yet.</Text>}
      {accounts.map((account) => <View key={account.id} style={{ padding: 16, backgroundColor: '#e8eaf0', borderRadius: 12, gap: 8 }}>
        <Text selectable style={{ fontWeight: '600' }}>{account.name} · {account.currencyCode}</Text>
        <Text selectable>Opening balance: {(account.openingBalanceMinor / 100).toFixed(2)} {account.currencyCode}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Set ${account.name} as favorite account`} disabled={pending || !!account.isFavorite} onPress={() => void makeFavorite(account.id)}><Text>{account.isFavorite ? '★ Favorite' : '☆ Set as favorite'}</Text></Pressable>
      </View>)}
    </View>}
  </ScrollView>;
}
