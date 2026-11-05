// THROWAWAY: Does A feel more coherent when it extends existing Quick Add interactions?
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { FormButton, FormInput, JoinedChoice } from '@/components/form-controls';
import { QuickAddCategory } from '@/components/quick-add-category';
import { QuickAddDate } from '@/components/quick-add-date';
import { balanceLine, c, FixtureNote, stubSave, type ProtoData } from './shared';

type Mode = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'PERSON';
const modes = [{ value: 'EXPENSE', label: 'Expense' }, { value: 'INCOME', label: 'Income' }, { value: 'TRANSFER', label: 'Transfer' }, { value: 'PERSON', label: 'Person' }] as const;
const actions = [{ value: 'LEND', label: 'Lend' }, { value: 'BORROW', label: 'Borrow' }, { value: 'RECEIVE', label: 'They paid back' }, { value: 'REPAY', label: 'I paid back' }] as const;
type Action = typeof actions[number]['value'];
type Chooser = 'account' | 'to' | 'person' | 'category' | null;

export function VariantAReuse({ data }: { data: ProtoData }) {
  const [mode, setMode] = useState<Mode>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(data.accounts.find((a) => a.isFavorite)?.id ?? data.accounts[0]?.id);
  const [toId, setToId] = useState<number>();
  const [personId, setPersonId] = useState<number>();
  const [people, setPeople] = useState(data.people);
  const [action, setAction] = useState<Action>('LEND');
  const [categoryId, setCategoryId] = useState<number>(data.expense[0]?.id);
  const [chooser, setChooser] = useState<Chooser>(null);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [date, setDate] = useState(new Date());
  const account = data.accounts.find((a) => a.id === accountId);
  const person = people.find((p) => p.id === personId);
  const incoming = mode === 'INCOME' || (mode === 'PERSON' && (action === 'BORROW' || action === 'RECEIVE'));
  const cats = mode === 'INCOME' ? data.income : data.expense;
  const destinations = data.accounts.filter((a) => a.id !== accountId && a.currencyCode === account?.currencyCode);
  const open = (value: Chooser) => { setQuery(''); setChooser(value); };
  const label = (text: string) => <Text style={{ color: c.muted, fontSize: 12 }}>{text}</Text>;
  const field = (title: string, value: string, target: Chooser) => <Pressable accessibilityRole="button" accessibilityLabel={`Choose ${title}`} onPress={() => open(target)} style={{ backgroundColor: c.surface, padding: 18, borderRadius: 18, gap: 6 }}>{label(title)}<Text style={{ color: c.text, fontSize: 18, fontWeight: '600' }}>{value} ›</Text></Pressable>;
  const saveLabel = mode === 'PERSON' ? ({ LEND: 'Save lending', BORROW: 'Save borrowing', RECEIVE: 'Save repayment received', REPAY: 'Save repayment made' }[action]) : mode === 'TRANSFER' ? 'Save transfer' : 'Save';
  const valid = Number(amount) > 0 && !!account && (mode === 'PERSON' ? !!person : mode === 'TRANSFER' ? destinations.some((a) => a.id === toId) : cats.some((cat) => cat.id === categoryId));
  if (chooser) {
    const items = chooser === 'person' ? people.map((p) => ({ id: p.id, name: p.name, detail: balanceLine(p, account?.currencyCode) })) : chooser === 'category' ? cats.map((cat) => ({ ...cat, detail: '' })) : (chooser === 'to' ? destinations : data.accounts).map((a) => ({ ...a, detail: `${a.currencyCode}${a.isFavorite ? ' · Favorite' : ''}` }));
    const matches = items.filter((i) => `${i.name} ${i.detail}`.toLowerCase().includes(query.toLowerCase()));
    return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, gap: 12, paddingBottom: 140 }}>
      <FormButton variant="secondary" label="Back to quick add" onPress={() => open(null)} />
      <FormInput accessibilityLabel={`Search ${chooser}`} placeholder={`Search ${chooser === 'person' ? 'people' : chooser === 'category' ? 'categories' : 'accounts'}`} value={query} onChangeText={setQuery} />
      {matches.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => { if (chooser === 'person') setPersonId(item.id); else if (chooser === 'category') setCategoryId(item.id); else if (chooser === 'to') setToId(item.id); else { setAccountId(item.id); setToId(undefined); } open(null); }} style={{ minHeight: 64, justifyContent: 'center', borderBottomWidth: 1, borderColor: c.line, gap: 4 }}><Text style={{ color: c.text, fontSize: 16 }}>{item.name}</Text>{!!item.detail && <Text style={{ color: c.muted }}>{item.detail}</Text>}</Pressable>)}
      {!matches.length && <Text style={{ color: c.muted }}>No matches</Text>}
      {chooser === 'person' && query.trim() && !people.some((p) => p.name.toLowerCase() === query.trim().toLowerCase()) && <FormButton label={`Add “${query.trim()}”`} onPress={() => { const id = Math.max(0, ...people.map((p) => p.id)) + 1; setPeople([...people, { id, name: query.trim(), balances: [] }]); setPersonId(id); open(null); }} />}
    </ScrollView>;
  }
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, gap: 18, paddingBottom: 140 }}>
    <View style={{ gap: 6 }}>{label(`Amount · ${account?.currencyCode ?? ''}`)}<View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: c.line }}><Text style={{ color: c.text, fontSize: 48, fontWeight: '300' }}>{account?.currencyCode === 'BDT' ? '৳' : '$'}</Text><TextInput accessibilityLabel="Amount" keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.muted} value={amount} onChangeText={setAmount} style={{ flex: 1, color: c.text, fontSize: 48, fontWeight: '300', fontVariant: ['tabular-nums'] }} /></View></View>
    <JoinedChoice value={mode} options={modes} onChange={(value) => { setMode(value); if (value === 'EXPENSE' || value === 'INCOME') setCategoryId((value === 'INCOME' ? data.income : data.expense)[0]?.id); }} />
    {field(mode === 'TRANSFER' ? 'From account' : incoming ? 'Into account' : 'Account', `${account?.name} · ${account?.currencyCode}${account?.isFavorite ? ' · Favorite' : ''}`, 'account')}
    {mode === 'TRANSFER' && <>{field('To account', data.accounts.find((a) => a.id === toId)?.name ?? 'Choose an account', 'to')}{!destinations.length && <Text style={{ color: c.muted }}>No other accounts in {account?.currencyCode}.</Text>}</>}
    {mode === 'PERSON' && <>
      {field('Person', person?.name ?? 'Choose a person', 'person')}
      <View style={{ gap: 10 }}>{label('What happened')}<JoinedChoice value={action} options={actions.slice(0, 2)} onChange={setAction} /><JoinedChoice value={action} options={actions.slice(2)} onChange={setAction} /></View>
      <Text style={{ color: c.muted }}>{incoming ? 'Money into' : 'Money out of'} {account?.name}. Excluded from spending reports.{person ? `\n${person.name}: ${balanceLine(person, account?.currencyCode)}. Recorded balances may be incomplete.` : ''}</Text>
    </>}
    {(mode === 'EXPENSE' || mode === 'INCOME') && <QuickAddCategory key={mode} categories={cats.map((cat) => ({ ...cat, parentId: null, parentName: null, needsReview: 0 }))} orderedIds={cats.map((cat) => cat.id)} selectedId={categoryId} onSelect={setCategoryId} onOpenAll={() => open('category')} />}
    <View style={{ gap: 12 }}>{label('Note · optional')}<FormInput accessibilityLabel="Note" placeholder="Add a note" value={note} onChangeText={setNote} />{label('Tags · optional')}<FormInput accessibilityLabel="Tags" placeholder="Comma-separated tags" value={tags} onChangeText={setTags} /><QuickAddDate value={date} onChange={setDate} /></View>
    <FormButton label={saveLabel} disabled={!valid} onPress={() => stubSave(`${mode} · ${amount} ${account?.currencyCode}\n${account?.name}${mode === 'PERSON' ? ` · ${action} · ${person?.name}` : mode === 'TRANSFER' ? ` → ${data.accounts.find((a) => a.id === toId)?.name}` : ` · ${cats.find((cat) => cat.id === categoryId)?.name}`}\n${date.toLocaleDateString()}\n${note}\n${tags}`)} />
    <FixtureNote data={data} />
  </ScrollView>;
}
