// THROWAWAY: Does A feel more coherent when it extends existing Quick Add interactions?
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { FormButton, FormInput, JoinedChoice } from '@/components/form-controls';
import { QuickAddCategory } from '@/components/quick-add-category';
import { QuickAddDate } from '@/components/quick-add-date';
import { balanceLine, Chip, Row, c, FixtureNote, stubSave, type ProtoData } from './shared';

type Mode = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'PERSON';
const modes = [{ value: 'EXPENSE', label: 'Expense' }, { value: 'INCOME', label: 'Income' }, { value: 'TRANSFER', label: 'Transfer' }, { value: 'PERSON', label: 'Person' }] as const;
const actions = [{ value: 'LEND', label: 'Lend' }, { value: 'BORROW', label: 'Borrow' }, { value: 'RECEIVE', label: 'They paid back' }, { value: 'REPAY', label: 'I paid back' }] as const;
type Action = typeof actions[number]['value'];

export function VariantAReuse({ data }: { data: ProtoData }) {
  const [mode, setMode] = useState<Mode>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(data.accounts.find((a) => a.isFavorite)?.id ?? data.accounts[0]?.id);
  const [toId, setToId] = useState<number>();
  const [personId, setPersonId] = useState<number>();
  const [people, setPeople] = useState(data.people);
  const [action, setAction] = useState<Action>('LEND');
  const [categoryId, setCategoryId] = useState<number>(data.expense[0]?.id);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [date, setDate] = useState(new Date());
  const account = data.accounts.find((a) => a.id === accountId);
  const person = people.find((p) => p.id === personId);
  const incoming = mode === 'INCOME' || (mode === 'PERSON' && (action === 'BORROW' || action === 'RECEIVE'));
  const cats = mode === 'INCOME' ? data.income : data.expense;
  const destinations = data.accounts.filter((a) => a.id !== accountId && a.currencyCode === account?.currencyCode);
  const label = (text: string) => <Text style={{ color: c.muted, fontSize: 12 }}>{text}</Text>;
  const saveLabel = mode === 'PERSON' ? ({ LEND: 'Save lending', BORROW: 'Save borrowing', RECEIVE: 'Save repayment received', REPAY: 'Save repayment made' }[action]) : mode === 'TRANSFER' ? 'Save transfer' : 'Save';
  const valid = Number(amount) > 0 && !!account && (mode === 'PERSON' ? !!person : mode === 'TRANSFER' ? destinations.some((a) => a.id === toId) : cats.some((cat) => cat.id === categoryId));
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, gap: 18, paddingBottom: 140 }}>
    <View style={{ gap: 6 }}>{label(`Amount · ${account?.currencyCode ?? ''}`)}<View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: c.line }}><Text style={{ color: c.text, fontSize: 48, fontWeight: '300' }}>{account?.currencyCode === 'BDT' ? '৳' : '$'}</Text><TextInput accessibilityLabel="Amount" keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.muted} value={amount} onChangeText={setAmount} style={{ flex: 1, color: c.text, fontSize: 48, fontWeight: '300', fontVariant: ['tabular-nums'] }} /></View></View>
    <JoinedChoice value={mode} options={modes} onChange={(value) => { setMode(value); if (value === 'EXPENSE' || value === 'INCOME') setCategoryId((value === 'INCOME' ? data.income : data.expense)[0]?.id); }} />
    <View style={{ gap: 10 }}>
      {label(`${incoming ? 'Into' : 'From'} ${account?.name ?? 'an account'}`)}
      <Row>{data.accounts.map((item) => <Chip key={item.id} label={`${item.name}${item.isFavorite ? ' ★' : ''}`} sub={item.currencyCode} selected={item.id === accountId} onPress={() => { setAccountId(item.id); setToId(undefined); }} />)}</Row>
    </View>
    {mode === 'TRANSFER' && <View style={{ gap: 10 }}>
      {label(`To ${destinations.find((item) => item.id === toId)?.name ?? 'another account'}`)}
      <Row>{destinations.map((item) => <Chip key={item.id} label={item.name} selected={item.id === toId} onPress={() => setToId(item.id)} />)}</Row>
      {!destinations.length && <Text style={{ color: c.muted }}>No other accounts in {account?.currencyCode}.</Text>}
    </View>}
    {mode === 'PERSON' && <>
      <View style={{ gap: 10 }}>
        {label(`With ${person?.name ?? 'a person'}`)}
        <FormInput accessibilityLabel="Search people" placeholder="Find or add a person" value={query} onChangeText={setQuery} />
        <Row>{people.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase())).map((item) => <Chip key={item.id} label={item.name} sub={balanceLine(item, account?.currencyCode)} selected={item.id === personId} onPress={() => setPersonId(item.id)} />)}</Row>
        {query.trim() && !people.some((item) => item.name.toLowerCase() === query.trim().toLowerCase()) && <FormButton variant="secondary" label={`Add “${query.trim()}”`} onPress={() => { const id = Math.max(0, ...people.map((item) => item.id)) + 1; setPeople([...people, { id, name: query.trim(), balances: [] }]); setPersonId(id); setQuery(''); }} />}
      </View>
      <View style={{ gap: 10 }}>{label('What happened')}<JoinedChoice value={action} options={actions.slice(0, 2)} onChange={setAction} /><JoinedChoice value={action} options={actions.slice(2)} onChange={setAction} /></View>
      <Text style={{ color: c.muted }}>{incoming ? 'Money into' : 'Money out of'} {account?.name}. Excluded from spending reports.{person ? `\n${person.name}: ${balanceLine(person, account?.currencyCode)}. Recorded balances may be incomplete.` : ''}</Text>
    </>}
    {(mode === 'EXPENSE' || mode === 'INCOME') && <QuickAddCategory key={mode} categories={cats.map((cat) => ({ ...cat, parentId: null, parentName: null, needsReview: 0 }))} orderedIds={cats.map((cat) => cat.id)} selectedId={categoryId} onSelect={setCategoryId} />}
    <View style={{ gap: 12 }}>{label('Note · optional')}<FormInput accessibilityLabel="Note" placeholder="Add a note" value={note} onChangeText={setNote} />{label('Tags · optional')}<FormInput accessibilityLabel="Tags" placeholder="Comma-separated tags" value={tags} onChangeText={setTags} /><QuickAddDate value={date} onChange={setDate} /></View>
    <FormButton label={saveLabel} disabled={!valid} onPress={() => stubSave(`${mode} · ${amount} ${account?.currencyCode}\n${account?.name}${mode === 'PERSON' ? ` · ${action} · ${person?.name}` : mode === 'TRANSFER' ? ` → ${data.accounts.find((a) => a.id === toId)?.name}` : ` · ${cats.find((cat) => cat.id === categoryId)?.name}`}\n${date.toLocaleDateString()}\n${note}\n${tags}`)} />
    <FixtureNote data={data} />
  </ScrollView>;
}
