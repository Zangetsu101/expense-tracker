import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createAccount, listManagedAccounts, setFavoriteAccount, type ManagedAccount } from '@/lib/accounts';
import { accountBalances } from '@/lib/reports';

const colors = { bg: '#101820', surface: '#1d2a34', raised: '#263641', line: '#35434d', ink: '#f1f5f4', muted: '#b1c0c7', accent: '#8be0be', negative: '#f4b8a9' };

function money(minor: number, currency: string) {
  return `${minor < 0 ? '−' : ''}${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function AccountsScreen() {
  const insets = useSafeAreaInsets();
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [balances, setBalances] = useState<Record<number, number>>({});
  const [name, setName] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [sheet, setSheet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    setBalances({});
    try {
      const [rows, totals] = await Promise.all([listManagedAccounts(), accountBalances()]);
      const nextBalances = Object.fromEntries(totals.map(row => [row.id, row.balanceMinor]));
      if (rows.some(row => nextBalances[row.id] === undefined)) throw new Error('Account balances unavailable.');
      setAccounts(rows);
      setBalances(nextBalances);
    } catch (e) { setBalances({}); setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save() {
    if (pending) return;
    setPending(true);
    setFormError(undefined);
    try {
      await createAccount({ name, currencyCode, openingBalance });
    } catch (e) {
      setFormError(String(e));
      setPending(false);
      return;
    }
    setName(''); setCurrencyCode(''); setOpeningBalance('0'); setSheet(false);
    try { await load(); }
    finally { setPending(false); }
  }
  async function makeFavorite(id: number) {
    if (pending) return;
    setPending(true); setError(undefined);
    try { await setFavoriteAccount(id); await load(); }
    catch (e) { setError(String(e)); }
    finally { setPending(false); }
  }
  const groups = new Map<string, ManagedAccount[]>();
  for (const account of accounts) {
    const group = groups.get(account.currencyCode) ?? [];
    group.push(account);
    groups.set(account.currencyCode, group);
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const action = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: colors.accent, fontWeight: '600' }}>{label}</Text></Pressable>;

  return <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 18 }}>
      {!loading && !error && accounts.length > 0 && <View style={{ backgroundColor: colors.raised, borderRadius: 20, padding: 20, gap: 8 }}>
        <Text style={{ color: colors.muted }}>Balance overview</Text>
        {sortedGroups.map(([code, group]) => {
          const total = group.reduce((sum, account) => sum + (balances[account.id] ?? account.openingBalanceMinor), 0);
          return <Text key={code} selectable style={{ color: total < 0 ? colors.negative : colors.ink, fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{money(total, code)}</Text>;
        })}
        <Text style={{ color: colors.muted, fontSize: 12 }}>Totals are separate by currency</Text>
      </View>}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: colors.ink, fontSize: 21, fontWeight: '700', flexShrink: 1 }}>Accounts ({accounts.length})</Text>
        {action('Add account', () => { setFormError(undefined); setSheet(true); })}
      </View>
      {error && <Text selectable accessibilityRole="alert" style={{ color: colors.negative }}>{error}</Text>}
      {loading ? <ActivityIndicator color={colors.accent} /> : error ? null : accounts.length === 0 ? <Text style={{ color: colors.muted }}>No accounts yet.</Text> : sortedGroups.map(([code, group]) => <View key={code} style={{ gap: 8 }}>
        <Text style={{ color: colors.accent, fontSize: 17, fontWeight: '700' }}>{code} · {group.length} accounts</Text>
        {group.map(account => <View key={account.id} style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text selectable style={{ color: colors.ink, fontSize: 16, fontWeight: '600' }}>{account.name}{account.isFavorite ? ' · Favorite' : ''}</Text>
            <Text selectable style={{ color: (balances[account.id] ?? account.openingBalanceMinor) < 0 ? colors.negative : colors.muted, fontVariant: ['tabular-nums'] }}>{money(balances[account.id] ?? account.openingBalanceMinor, code)}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${account.name}, ${account.isFavorite ? 'favorite' : 'set as favorite'} for Quick add`} accessibilityState={{ selected: !!account.isFavorite, disabled: pending || !!account.isFavorite }} disabled={pending || !!account.isFavorite} onPress={() => void makeFavorite(account.id)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><Text accessible={false} style={{ color: account.isFavorite ? colors.accent : colors.muted, fontSize: 28 }}>{account.isFavorite ? '★' : '☆'}</Text></Pressable>
        </View>)}
      </View>)}
    </ScrollView>
    <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => { if (!pending) setSheet(false); }}>
      <View style={{ flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss add account" disabled={pending} onPress={() => setSheet(false)} style={{ flex: 1 }} />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: insets.bottom + 24, gap: 16 }}>
          <Text style={{ color: colors.ink, fontSize: 22, fontWeight: '700' }}>Add account</Text>
          <TextInput accessibilityLabel="Account name" placeholder="Account name" placeholderTextColor={colors.muted} value={name} onChangeText={setName} maxLength={100} style={{ color: colors.ink, borderBottomWidth: 1, borderColor: colors.line, padding: 12 }} />
          <TextInput accessibilityLabel="Currency code" placeholder="Currency (e.g. BDT)" placeholderTextColor={colors.muted} value={currencyCode} onChangeText={setCurrencyCode} autoCapitalize="characters" maxLength={3} style={{ color: colors.ink, borderBottomWidth: 1, borderColor: colors.line, padding: 12 }} />
          <TextInput accessibilityLabel="Opening balance" placeholder="Opening balance" placeholderTextColor={colors.muted} value={openingBalance} onChangeText={setOpeningBalance} keyboardType="decimal-pad" style={{ color: colors.ink, borderBottomWidth: 1, borderColor: colors.line, padding: 12 }} />
          <Text style={{ color: colors.muted }}>Currency is fixed after creation. Opening balance may be negative.</Text>
          {formError && <Text selectable accessibilityRole="alert" style={{ color: colors.negative }}>{formError}</Text>}
          {action(pending ? 'Saving…' : 'Create account', () => void save(), pending)}
          {action('Cancel', () => setSheet(false), pending)}
        </ScrollView>
      </View>
    </Modal>
  </View>;
}
