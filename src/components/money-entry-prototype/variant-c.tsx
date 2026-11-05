// PROTOTYPE variant C — "Intent first": the + opens a launcher of intents (grouped), with
// people who have open balances surfaced as one-tap shortcuts. Picking an intent opens a
// sentence-style composer ("I lent ৳500 to Rafi from Cash"). Deliberately NOT amount-first.
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AmountInput, Chip, FixtureNote, Label, Row, SaveBar, balanceLine, c, stubSave, type ProtoData } from './shared';

export const name = 'Intent first';
type Intent = 'SPENT' | 'RECEIVED' | 'MOVED' | 'LEND' | 'BORROW' | 'RECEIVE_REPAYMENT' | 'REPAY';
const groups: { title: string; items: { key: Intent; icon: string; label: string }[] }[] = [
  { title: 'Everyday', items: [{ key: 'SPENT', icon: '↑', label: 'Spent' }, { key: 'RECEIVED', icon: '↓', label: 'Received' }] },
  { title: 'My accounts', items: [{ key: 'MOVED', icon: '⇄', label: 'Moved money' }] },
  { title: 'With people', items: [{ key: 'LEND', icon: '🤝', label: 'Lent' }, { key: 'BORROW', icon: '🙏', label: 'Borrowed' }, { key: 'RECEIVE_REPAYMENT', icon: '↩', label: 'Got paid back' }, { key: 'REPAY', icon: '↪', label: 'Paid back' }] },
];
const verb: Record<Intent, string> = { SPENT: 'I spent', RECEIVED: 'I received', MOVED: 'I moved', LEND: 'I lent', BORROW: 'I borrowed', RECEIVE_REPAYMENT: 'got back', REPAY: 'I paid back' };
type Slot = 'who' | 'account' | 'to' | 'category' | null;

export function VariantC({ data }: { data: ProtoData }) {
  const [intent, setIntent] = useState<Intent>();
  const [amount, setAmount] = useState('');
  const [personId, setPersonId] = useState<number>();
  const [accountId, setAccountId] = useState(data.accounts[0]?.id);
  const [toId, setToId] = useState<number>();
  const [categoryId, setCategoryId] = useState<number>();
  const [slot, setSlot] = useState<Slot>(null);
  const account = data.accounts.find((a) => a.id === accountId);
  const person = data.people.find((p) => p.id === personId);
  const owing = data.people.filter((p) => p.balances.length);

  if (!intent) return <ScrollView contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 140 }}>
    <Text style={{ color: c.text, fontSize: 24, fontWeight: '700' }}>What happened?</Text>
    {groups.map((g) => <View key={g.title} style={{ gap: 10 }}>
      <Label>{g.title}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {g.items.map((it) => <Pressable key={it.key} onPress={() => { setIntent(it.key); setSlot(it.key === 'SPENT' || it.key === 'RECEIVED' ? 'category' : it.key === 'MOVED' ? 'to' : 'who'); }} style={({ pressed }) => ({ width: g.items.length === 1 ? '100%' : '48.3%', minHeight: 76, padding: 14, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, justifyContent: 'space-between', opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ fontSize: 20, color: c.accent }}>{it.icon}</Text>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{it.label}</Text>
        </Pressable>)}
      </View>
    </View>)}
    {owing.length > 0 && <View style={{ gap: 10 }}>
      <Label>Open balances</Label>
      {owing.map((p) => { const theyOwe = p.balances.some((b) => b.theyOweMinor); return <Pressable key={p.id} onPress={() => { setPersonId(p.id); setIntent(theyOwe ? 'RECEIVE_REPAYMENT' : 'REPAY'); setSlot(null); }} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: c.surface, gap: 10 }}>
        <View style={{ flex: 1 }}><Text style={{ color: c.text, fontWeight: '600' }}>{p.name}</Text><Text style={{ color: c.muted, fontSize: 12 }}>{balanceLine(p)}</Text></View>
        <Text style={{ color: c.accent }}>{theyOwe ? 'Got paid back ›' : 'Pay back ›'}</Text>
      </Pressable>; })}
    </View>}
    <FixtureNote data={data} />
  </ScrollView>;

  const peopleIntent = intent === 'LEND' || intent === 'BORROW' || intent === 'RECEIVE_REPAYMENT' || intent === 'REPAY';
  const moneyIn = intent === 'RECEIVED' || intent === 'BORROW' || intent === 'RECEIVE_REPAYMENT';
  const Token = ({ s, text }: { s: Exclude<Slot, null>; text: string }) => <Text onPress={() => setSlot(slot === s ? null : s)} style={{ color: slot === s ? c.background : c.accent, backgroundColor: slot === s ? c.accent : c.raised, borderRadius: 8, overflow: 'hidden' }}>{` ${text} ▾ `}</Text>;
  const cat = [...data.expense, ...data.income].find((x) => x.id === categoryId);
  const to = data.accounts.find((a) => a.id === toId);

  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 140 }}>
    <Pressable onPress={() => { setIntent(undefined); setSlot(null); }}><Text style={{ color: c.accent }}>‹ What happened?</Text></Pressable>
    <AmountInput value={amount} onChange={setAmount} currency={account?.currencyCode} color={moneyIn ? c.accent : c.text} />
    <Text style={{ color: c.text, fontSize: 22, lineHeight: 40 }}>
      {intent === 'RECEIVE_REPAYMENT' ? <><Token s="who" text={person?.name ?? 'someone'} /> paid me back</> : verb[intent]}
      {intent === 'SPENT' && <> on <Token s="category" text={cat?.name ?? 'category'} /></>}
      {intent === 'RECEIVED' && <> as <Token s="category" text={cat?.name ?? 'category'} /></>}
      {(intent === 'LEND' || intent === 'REPAY') && <> {intent === 'LEND' ? 'to' : ''} <Token s="who" text={person?.name ?? 'someone'} /></>}
      {intent === 'BORROW' && <> from <Token s="who" text={person?.name ?? 'someone'} /></>}
      {moneyIn ? ' into ' : ' from '}<Token s="account" text={account?.name ?? 'account'} />
      {intent === 'MOVED' && <> to <Token s="to" text={to?.name ?? 'account'} /></>}
      {' '}<Text style={{ color: c.muted }}>today ▾</Text>
    </Text>
    {peopleIntent && person && <Text style={{ color: c.muted }}>{person.name}: {balanceLine(person, account?.currencyCode)}</Text>}

    {slot === 'who' && <Row>{data.people.map((p) => <Chip key={p.id} label={p.name} sub={balanceLine(p, account?.currencyCode)} selected={p.id === personId} onPress={() => { setPersonId(p.id); setSlot(null); }} />)}<Chip label="+ New person" onPress={() => {}} /></Row>}
    {slot === 'account' && <Row>{data.accounts.map((a) => <Chip key={a.id} label={a.name} selected={a.id === accountId} onPress={() => { setAccountId(a.id); setSlot(null); }} />)}</Row>}
    {slot === 'to' && <Row>{data.accounts.filter((a) => a.id !== accountId && a.currencyCode === account?.currencyCode).map((a) => <Chip key={a.id} label={a.name} selected={a.id === toId} onPress={() => { setToId(a.id); setSlot(null); }} />)}</Row>}
    {slot === 'category' && <Row>{(moneyIn ? data.income : data.expense).slice(0, 10).map((x) => <Chip key={x.id} label={x.name} selected={x.id === categoryId} onPress={() => { setCategoryId(x.id); setSlot(null); }} />)}</Row>}

    <Text style={{ color: c.muted }}>Note · Tags</Text>
    <SaveBar label="Save" onPress={() => stubSave(`${intent} ${amount} ${person?.name ?? ''} ${account?.name ?? ''}`)} />
  </ScrollView>;
}
