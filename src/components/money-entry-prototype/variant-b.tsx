// PROTOTYPE variant B — "Where did it go?": only Money out / Money in, then ONE counterparty picker
// mixing Categories, your Accounts and People. The counterparty decides the transaction type:
// category → Expense/Income, own account → Transfer, person → Lend/Repay or Borrow/Repaid (from balance).
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AmountInput, Chip, FixtureNote, Label, Row, SaveBar, balanceLine, c, money, stubSave, type ProtoData, type ProtoPerson } from './shared';

export const name = 'Where did it go?';
type Dir = 'out' | 'in';
type Target = { kind: 'category' | 'account' | 'person'; id: number };

function personDefault(dir: Dir, p: ProtoPerson, currency?: string) {
  const b = p.balances.find((x) => x.currency === currency);
  if (dir === 'out') return b?.youOweMinor ? 'REPAY' : 'LEND';
  return b?.theyOweMinor ? 'RECEIVE_REPAYMENT' : 'BORROW';
}

export function VariantB({ data }: { data: ProtoData }) {
  const [dir, setDir] = useState<Dir>('out');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(data.accounts[0]?.id);
  const [target, setTarget] = useState<Target>();
  const [override, setOverride] = useState<string>();
  const [query, setQuery] = useState('');
  const account = data.accounts.find((a) => a.id === accountId);
  const q = query.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);
  const cats = (dir === 'out' ? data.expense : data.income).filter((x) => match(x.name));
  const accounts = data.accounts.filter((a) => a.id !== accountId && a.currencyCode === account?.currencyCode && match(a.name));
  const people = data.people.filter((p) => match(p.name));
  const pick = (t: Target) => { setTarget(t); setOverride(undefined); };
  const isSel = (k: Target['kind'], id: number) => target?.kind === k && target.id === id;

  let resolved = 'Pick where the money went';
  let alt: { label: string; kind: string } | undefined;
  let kindLabel = '';
  if (target?.kind === 'category') {
    const cat = [...data.expense, ...data.income].find((x) => x.id === target.id);
    kindLabel = dir === 'out' ? 'Expense' : 'Income'; resolved = `${kindLabel} · ${cat?.name}`;
  } else if (target?.kind === 'account') {
    const other = data.accounts.find((a) => a.id === target.id);
    kindLabel = 'Transfer'; resolved = dir === 'out' ? `Transfer · ${account?.name} → ${other?.name}` : `Transfer · ${other?.name} → ${account?.name}`;
  } else if (target?.kind === 'person') {
    const p = data.people.find((x) => x.id === target.id)!;
    const k = override ?? personDefault(dir, p, account?.currencyCode);
    kindLabel = { LEND: 'Lend', REPAY: 'Repay', BORROW: 'Borrow', RECEIVE_REPAYMENT: 'Repayment received' }[k]!;
    resolved = { LEND: `Lent to ${p.name}`, REPAY: `Paid back ${p.name}`, BORROW: `Borrowed from ${p.name}`, RECEIVE_REPAYMENT: `${p.name} paid you back` }[k]!;
    const other = dir === 'out' ? (k === 'LEND' ? 'REPAY' : 'LEND') : (k === 'BORROW' ? 'RECEIVE_REPAYMENT' : 'BORROW');
    alt = { kind: other, label: { LEND: `No — I lent ${p.name} more`, REPAY: `No — I was paying ${p.name} back`, BORROW: `No — I borrowed more from ${p.name}`, RECEIVE_REPAYMENT: `No — ${p.name} was paying me back` }[other]! };
    resolved += ` · ${balanceLine(p, account?.currencyCode)}`;
  }

  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 140 }}>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {(['out', 'in'] as Dir[]).map((d) => <Pressable key={d} onPress={() => { setDir(d); setTarget(undefined); }} style={{ flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: dir === d ? (d === 'out' ? c.warning : c.accent) : c.line, backgroundColor: dir === d ? c.raised : 'transparent' }}>
        <Text style={{ color: dir === d ? (d === 'out' ? c.warning : c.accent) : c.muted, fontWeight: '700', fontSize: 16 }}>{d === 'out' ? '↑ Money out' : '↓ Money in'}</Text>
      </Pressable>)}
    </View>
    <AmountInput value={amount} onChange={setAmount} currency={account?.currencyCode} color={dir === 'out' ? c.text : c.accent} />
    <View style={{ gap: 8 }}>
      <Label>{dir === 'out' ? 'From' : 'Into'}</Label>
      <Row>{data.accounts.map((a) => <Chip key={a.id} label={`${a.name}${a.isFavorite ? ' ★' : ''}`} selected={a.id === accountId} onPress={() => { setAccountId(a.id); setTarget(undefined); }} />)}</Row>
    </View>

    <View style={{ backgroundColor: c.surface, borderRadius: 16, padding: 14, gap: 6, borderWidth: 1, borderColor: target ? c.accent : c.line }}>
      <Text style={{ color: c.muted, fontSize: 12 }}>{kindLabel ? kindLabel.toUpperCase() : 'WILL BE SAVED AS'}</Text>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{resolved}</Text>
      {alt && <Pressable onPress={() => setOverride(alt!.kind)}><Text style={{ color: c.accent, paddingTop: 4 }}>{alt.label}</Text></Pressable>}
    </View>

    <TextInput placeholder={dir === 'out' ? 'Where did it go? Category, account, person' : 'Where did it come from?'} placeholderTextColor={c.muted} value={query} onChangeText={setQuery}
      style={{ color: c.text, backgroundColor: c.surface, borderRadius: 14, paddingHorizontal: 14, minHeight: 48, fontSize: 16 }} />
    {cats.length > 0 && <View style={{ gap: 8 }}><Label>Categories</Label><Row>{cats.slice(0, 8).map((x) => <Chip key={x.id} icon="🏷" label={x.name} selected={isSel('category', x.id)} onPress={() => pick({ kind: 'category', id: x.id })} />)}</Row></View>}
    {people.length > 0 && <View style={{ gap: 8 }}><Label>People</Label><Row>{people.map((p) => <Chip key={p.id} icon="👤" label={p.name} sub={balanceLine(p, account?.currencyCode)} selected={isSel('person', p.id)} onPress={() => pick({ kind: 'person', id: p.id })} />)}<Chip icon="👤" label={q ? `+ Add “${query.trim()}”` : '+ New'} onPress={() => {}} /></Row></View>}
    {accounts.length > 0 && <View style={{ gap: 8 }}><Label>{dir === 'out' ? 'To my account' : 'From my account'}</Label><Row>{accounts.map((a) => <Chip key={a.id} icon="🏦" label={a.name} selected={isSel('account', a.id)} onPress={() => pick({ kind: 'account', id: a.id })} />)}</Row></View>}

    <Text style={{ color: c.muted }}>Note · Tags · Today ▾</Text>
    <SaveBar label={target ? `Save · ${kindLabel}` : 'Save'} disabled={!target} onPress={() => stubSave(`${resolved} · ${money(Number(amount || 0) * 100, account?.currencyCode ?? 'BDT')}`)} />
    <FixtureNote data={data} />
  </ScrollView>;
}
