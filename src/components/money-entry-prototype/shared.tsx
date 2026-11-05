// PROTOTYPE — throwaway. Question: how should Expense, Income, Transfer and Lending/Borrowing
// entry flow together? Three variants on /quick-add?variant=A|B|C (plus `now` = current screen).
// Reads real data (falls back to fixtures when the DB is empty). Saves are stubbed: nothing is written.
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { listAccounts, listCategories, type Account, type Category } from '@/lib/database';
import { listLendingTotals, listPeople, type LendingTotal, type Person } from '@/lib/lending';
import { theme } from '@/theme';

export const c = theme.colors;

export type Balance = { currency: string; theyOweMinor: number; youOweMinor: number };
export type ProtoPerson = Person & { balances: Balance[] };
export type ProtoData = { accounts: Account[]; expense: Category[]; income: Category[]; people: ProtoPerson[]; fixture: boolean };

const fixture: ProtoData = {
  fixture: true,
  accounts: [
    { id: 1, name: 'Cash', currencyCode: 'BDT', isFavorite: 1 },
    { id: 2, name: 'bKash', currencyCode: 'BDT', isFavorite: 0 },
    { id: 3, name: 'City Bank', currencyCode: 'BDT', isFavorite: 0 },
    { id: 4, name: 'Payoneer', currencyCode: 'USD', isFavorite: 0 },
  ],
  expense: ['Food & Drink', 'Transport', 'Groceries', 'Bills', 'Rent', 'Shopping', 'Health', 'Gifts'].map((name, i) => ({ id: 100 + i, name, type: 'EXPENSE' as const })),
  income: ['Salary', 'Freelance', 'Interest', 'Gifts received'].map((name, i) => ({ id: 200 + i, name, type: 'INCOME' as const })),
  people: [
    { id: 1, name: 'Rafi', balances: [{ currency: 'BDT', theyOweMinor: 250000, youOweMinor: 0 }] },
    { id: 2, name: 'Nadia', balances: [{ currency: 'BDT', theyOweMinor: 0, youOweMinor: 100000 }] },
    { id: 3, name: 'Arif', balances: [] },
    { id: 4, name: 'Mum', balances: [{ currency: 'BDT', theyOweMinor: 50000, youOweMinor: 300000 }] },
  ],
};

function balancesFor(personId: number, totals: LendingTotal[]): Balance[] {
  const map = new Map<string, Balance>();
  for (const t of totals.filter((x) => x.personId === personId)) {
    const b = map.get(t.currencyCode) ?? { currency: t.currencyCode, theyOweMinor: 0, youOweMinor: 0 };
    if (t.direction === 'LENT') b.theyOweMinor += t.outstandingMinor; else b.youOweMinor += t.outstandingMinor;
    map.set(t.currencyCode, b);
  }
  return [...map.values()].filter((b) => b.theyOweMinor || b.youOweMinor);
}

export function useProtoData() {
  const [data, setData] = useState<ProtoData>();
  useEffect(() => {
    Promise.all([listAccounts(), listCategories('EXPENSE'), listCategories('INCOME'), listPeople(), listLendingTotals()])
      .then(([accounts, expense, income, people, totals]) => {
        if (accounts.length < 3) { setData(fixture); return; }
        setData({
          fixture: false, accounts, expense, income,
          people: people.length ? people.map((p) => ({ ...p, balances: balancesFor(p.id, totals) })) : fixture.people,
        });
      })
      .catch(() => setData(fixture));
  }, []);
  return data;
}

export function money(minor: number, currency: string) {
  const symbol = currency === 'BDT' ? '৳' : currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export function balanceLine(p: ProtoPerson, currency?: string) {
  const list = currency ? p.balances.filter((b) => b.currency === currency) : p.balances;
  if (!list.length) return 'Settled';
  return list.map((b) => [b.theyOweMinor ? `owes you ${money(b.theyOweMinor, b.currency)}` : '', b.youOweMinor ? `you owe ${money(b.youOweMinor, b.currency)}` : ''].filter(Boolean).join(' · ')).join(' · ');
}

export function stubSave(summary: string) {
  Alert.alert('PROTOTYPE — not saved', summary);
}

export function Chip({ label, sub, selected, onPress, icon, tone }: { label: string; sub?: string; selected?: boolean; onPress: () => void; icon?: string; tone?: 'out' | 'in' }) {
  const toneColor = tone === 'out' ? c.warning : tone === 'in' ? c.accent : c.text;
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => ({
    paddingHorizontal: 14, paddingVertical: sub ? 8 : 10, borderRadius: 14, borderCurve: 'continuous', borderWidth: 1,
    borderColor: selected ? c.accent : c.line, backgroundColor: selected ? '#24463d' : c.surface, opacity: pressed ? 0.7 : 1,
  })}>
    <Text style={{ color: toneColor, fontSize: 15, fontWeight: selected ? '700' : '500' }}>{icon ? `${icon}  ` : ''}{label}</Text>
    {sub ? <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>{sub}</Text> : null}
  </Pressable>;
}

export function Row({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) {
  return <View style={{ flexDirection: 'row', flexWrap: wrap ? 'wrap' : 'nowrap', gap: 8 }}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' }}>{children}</Text>;
}

export function AmountInput({ value, onChange, currency, color = c.text, size = 48 }: { value: string; onChange: (v: string) => void; currency?: string; color?: string; size?: number }) {
  return <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
    <Text style={{ color: c.muted, fontSize: size * 0.6, fontWeight: '300' }}>{currency === 'BDT' ? '৳' : currency === 'USD' ? '$' : currency ?? ''}</Text>
    <TextInput accessibilityLabel="Amount" keyboardType="decimal-pad" placeholder="0" placeholderTextColor={c.line} value={value} onChangeText={onChange}
      style={{ flex: 1, color, fontSize: size, fontWeight: '300', padding: 0, fontVariant: ['tabular-nums'] }} />
  </View>;
}

export function SaveBar({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => ({
    minHeight: 54, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.accent, opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
  })}><Text style={{ color: c.background, fontSize: 16, fontWeight: '700' }}>{label}</Text></Pressable>;
}

export function FixtureNote({ data }: { data: ProtoData }) {
  return data.fixture ? <Text style={{ color: c.muted, fontSize: 11 }}>Fixture data (DB too sparse). Saves are stubbed.</Text>
    : <Text style={{ color: c.muted, fontSize: 11 }}>Real data, stubbed saves — nothing is written.</Text>;
}
