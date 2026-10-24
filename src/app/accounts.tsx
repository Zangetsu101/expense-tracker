import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createAccount, listManagedAccounts, setFavoriteAccount, type ManagedAccount } from '@/lib/accounts';
import { accountBalances } from '@/lib/reports';
import { theme } from '@/theme';
import { FormButton, FormInput } from '@/components/form-controls';
import { AppSheet } from '@/components/app-sheet';

const colors = { ...theme.colors, bg: theme.colors.background, ink: theme.colors.text, negative: theme.colors.warning };

function money(minor: number, currency: string) {
  return `${minor < 0 ? '−' : ''}${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function AccountsScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
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
        <FormButton label="Add account" variant="secondary" disabled={pending} onPress={() => { setFormError(undefined); setSheet(true); }} />
      </View>
      {error && <><Text selectable accessibilityRole="alert" style={{ color: colors.negative }}>{error}</Text><FormButton label="Retry accounts" variant="secondary" disabled={pending} onPress={() => void load()} /></>}
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
    {sheet && <AppSheet pending={pending} onDismiss={() => { if (!pending) setSheet(false); }}>
        <ScrollView style={{ width, maxHeight: height * 0.82 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: theme.spacing.indent, paddingBottom: insets.bottom + theme.spacing.indent, gap: theme.spacing.lg }}>
          <Text style={{ color: colors.ink, fontSize: theme.type.heading, fontWeight: '700' }}>Add account</Text>
          <FormInput accessibilityLabel="Account name" placeholder="Account name" placeholderTextColor={colors.muted} value={name} onChangeText={setName} maxLength={100} editable={!pending} />
          <FormInput accessibilityLabel="Currency code" placeholder="Currency (e.g. BDT)" placeholderTextColor={colors.muted} value={currencyCode} onChangeText={setCurrencyCode} autoCapitalize="characters" maxLength={3} editable={!pending} />
          <FormInput accessibilityLabel="Opening balance" placeholder="Opening balance" placeholderTextColor={colors.muted} value={openingBalance} onChangeText={setOpeningBalance} keyboardType="numbers-and-punctuation" editable={!pending} />
          <Text style={{ color: colors.muted }}>Currency is fixed after creation. Opening balance may be negative.</Text>
          {formError && <Text selectable accessibilityRole="alert" style={{ color: colors.negative }}>{formError}</Text>}
          <FormButton label="Create account" loading={pending} onPress={() => void save()} />
          <FormButton label="Cancel" variant="secondary" disabled={pending} onPress={() => setSheet(false)} />
        </ScrollView>
    </AppSheet>}
  </View>;
}
