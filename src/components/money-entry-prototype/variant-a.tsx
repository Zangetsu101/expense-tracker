// PROTOTYPE variant A — "Four modes": one composer, a 4-way mode switch at the top.
// Person is a peer of Expense / Income / Transfer. Amount stays first; the body swaps per mode.
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AmountInput, Chip, FixtureNote, Label, Row, SaveBar, balanceLine, c, stubSave, type ProtoData } from './shared';

export const name = 'Four modes';
type Mode = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'PERSON';
type Action = 'LEND' | 'BORROW' | 'RECEIVE_REPAYMENT' | 'REPAY';
const actions: { key: Action; label: string; hint: string; tone: 'out' | 'in' }[] = [
  { key: 'LEND', label: 'Lend', hint: 'money out', tone: 'out' },
  { key: 'BORROW', label: 'Borrow', hint: 'money in', tone: 'in' },
  { key: 'RECEIVE_REPAYMENT', label: 'They paid back', hint: 'money in', tone: 'in' },
  { key: 'REPAY', label: 'I paid back', hint: 'money out', tone: 'out' },
];

export function VariantA({ data }: { data: ProtoData }) {
  const [mode, setMode] = useState<Mode>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(data.accounts[0]?.id);
  const [toId, setToId] = useState<number>();
  const [categoryId, setCategoryId] = useState<number>();
  const [personId, setPersonId] = useState<number>();
  const [action, setAction] = useState<Action>('LEND');
  const account = data.accounts.find((a) => a.id === accountId);
  const person = data.people.find((p) => p.id === personId);
  const cats = mode === 'INCOME' ? data.income : data.expense;
  const amt = amount || '0';
  const saveLabel = mode === 'EXPENSE' ? `Save expense` : mode === 'INCOME' ? 'Save income' : mode === 'TRANSFER'
    ? `Move ${amt} → ${data.accounts.find((a) => a.id === toId)?.name ?? '…'}`
    : person ? { LEND: `Lend ${amt} to ${person.name}`, BORROW: `Borrow ${amt} from ${person.name}`, RECEIVE_REPAYMENT: `${person.name} paid back ${amt}`, REPAY: `Pay back ${amt} to ${person.name}` }[action] : 'Choose a person';

  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 140 }}>
    <View style={{ flexDirection: 'row', backgroundColor: c.surface, borderRadius: 14, padding: 4, gap: 4 }}>
      {(['EXPENSE', 'INCOME', 'TRANSFER', 'PERSON'] as Mode[]).map((m) => <Pressable key={m} onPress={() => setMode(m)} style={{ flex: 1, minHeight: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === m ? c.accent : 'transparent' }}>
        <Text style={{ color: mode === m ? c.background : c.muted, fontWeight: '700', fontSize: 13 }}>{{ EXPENSE: 'Expense', INCOME: 'Income', TRANSFER: 'Transfer', PERSON: 'Person' }[m]}</Text>
      </Pressable>)}
    </View>
    <AmountInput value={amount} onChange={setAmount} currency={account?.currencyCode} />

    {mode === 'PERSON' && <View style={{ gap: 10 }}>
      <Label>With</Label>
      <Row>{data.people.map((p) => <Chip key={p.id} label={p.name} sub={balanceLine(p, account?.currencyCode)} selected={p.id === personId} onPress={() => setPersonId(p.id)} />)}<Chip label="+ New person" onPress={() => {}} /></Row>
      <Label>What happened</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {actions.map((a) => <Pressable key={a.key} onPress={() => setAction(a.key)} style={{ width: '48.5%', padding: 12, borderRadius: 14, borderWidth: 1, borderColor: action === a.key ? c.accent : c.line, backgroundColor: action === a.key ? '#24463d' : c.surface }}>
          <Text style={{ color: c.text, fontWeight: '700' }}>{a.label}</Text>
          <Text style={{ color: a.tone === 'out' ? c.warning : c.accent, fontSize: 12 }}>{a.tone === 'out' ? '↑' : '↓'} {a.hint}</Text>
        </Pressable>)}
      </View>
      {person && person.balances.length > 0 && <Text style={{ color: c.muted }}>{person.name} {balanceLine(person)}. Not counted in spending reports.</Text>}
    </View>}

    <View style={{ gap: 10 }}>
      <Label>{mode === 'TRANSFER' ? 'From' : mode === 'INCOME' || (mode === 'PERSON' && (action === 'BORROW' || action === 'RECEIVE_REPAYMENT')) ? 'Into account' : 'From account'}</Label>
      <Row>{data.accounts.map((a) => <Chip key={a.id} label={`${a.name}${a.isFavorite ? ' ★' : ''}`} selected={a.id === accountId} onPress={() => { setAccountId(a.id); if (toId === a.id) setToId(undefined); }} />)}</Row>
    </View>

    {mode === 'TRANSFER' && <View style={{ gap: 10 }}>
      <Label>To</Label>
      <Row>{data.accounts.filter((a) => a.id !== accountId && a.currencyCode === account?.currencyCode).map((a) => <Chip key={a.id} label={a.name} selected={a.id === toId} onPress={() => setToId(a.id)} />)}</Row>
    </View>}

    {(mode === 'EXPENSE' || mode === 'INCOME') && <View style={{ gap: 10 }}>
      <Label>Category</Label>
      <Row>{cats.slice(0, 10).map((cat) => <Chip key={cat.id} label={cat.name} selected={cat.id === categoryId} onPress={() => setCategoryId(cat.id)} />)}<Chip label="All…" onPress={() => {}} /></Row>
    </View>}

    <Text style={{ color: c.muted }}>Note · Tags · Today ▾</Text>
    <SaveBar label={saveLabel} onPress={() => stubSave(`${mode} ${amt} ${account?.name ?? ''}${person ? ` ${action} ${person.name}` : ''}`)} />
    <FixtureNote data={data} />
  </ScrollView>;
}
