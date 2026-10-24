import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { EditableTransaction } from '@/lib/transaction-edit';
import { formatEpochDay, formatTransactionAmount } from '@/lib/transaction-format';
import { formatLineItemAmount } from '@/lib/line-item-amount';
import { theme } from '@/theme';

const color = { ...theme.colors, panel: theme.colors.surface, ink: theme.colors.text };
type Props = { transaction: EditableTransaction };
function Label({ children }: { children: string }) {
  return <Text style={{ color: color.muted, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>{children}</Text>;
}
function Value({ children, muted = false }: { children: string; muted?: boolean }) {
  return <Text selectable style={{ color: muted ? color.muted : color.ink, fontSize: 16 }}>{children}</Text>;
}
function ItemRows({ row, limit }: { row: EditableTransaction; limit?: number }) {
  return <View style={{ gap: 12 }}>
    {row.lineItems.slice(0, limit).map((item, index) => <View key={item.id ?? index} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingBottom: 10, borderBottomWidth: 1, borderColor: color.line }}>
      <Text selectable style={{ color: color.ink, flex: 1 }}>{item.name}{item.quantity != null ? ` × ${item.quantity}` : ''}</Text>
      <Text selectable style={{ color: color.ink, fontVariant: ['tabular-nums'] }}>{formatLineItemAmount(item.amountMinor)} {row.currencyCode}</Text>
    </View>)}
  </View>;
}
function ItemSection({ row }: { row: EditableTransaction }) {
  const [open, setOpen] = useState(false);
  const count = row.lineItems.length;
  return <View style={{ backgroundColor: color.panel, borderRadius: 16, padding: 18, gap: 14 }}>
    <Label>{`Line Items · ${count}`}</Label>
    {!count ? <Value muted>No line items</Value> : <>
      <ItemRows row={row} limit={open ? undefined : 2} />
      {count > 2 && <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Show fewer line items' : `Show all ${count} line items`} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ paddingVertical: 10 }}>
        <Text style={{ color: color.accent, fontWeight: '600' }}>{open ? 'Show fewer' : `Show all ${count} items`}</Text>
      </Pressable>}
    </>}
    <Text style={{ color: color.muted, fontSize: 12 }}>Line Items do not change the Transaction amount.</Text>
  </View>;
}
export function TransactionReceipt({ transaction: row }: Props) {
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: color.background }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32, gap: 24 }}>
    <View style={{ backgroundColor: color.panel, borderRadius: 18, padding: 22, gap: 16 }}>
      <Label>{`${row.type === 'EXPENSE' ? 'Expense' : 'Income'} · ${row.currencyCode}`}</Label>
      <Text selectable style={{ color: row.type === 'INCOME' ? color.accent : color.ink, fontSize: 40, fontWeight: '300', fontVariant: ['tabular-nums'] }}>{formatTransactionAmount(row.type, row.amountMinor, row.currencyCode)}</Text>
      <Text selectable style={{ color: color.ink, fontSize: 20, fontWeight: '700' }}>{row.categoryName ?? 'Uncategorized'}</Text>
      <View style={{ height: 1, backgroundColor: color.line }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
        <View style={{ gap: 8 }}><Label>Account</Label><Value>{row.accountName}</Value></View>
        <View style={{ gap: 8 }}><Label>Date</Label><Value>{formatEpochDay(row.date)}</Value></View>
      </View>
    </View>
    <View style={{ gap: 8 }}><Label>Note</Label><Value muted={!row.note}>{row.note || 'No note'}</Value></View>
    <View style={{ gap: 8 }}><Label>Tags</Label><Value muted={!row.tags.length}>{row.tags.map((tag) => `#${tag.name}`).join('  ') || 'No tags'}</Value></View>
    <ItemSection row={row} />
    <View style={{ gap: 8 }}><Label>Reports</Label><Value>{row.excludeFromReport ? 'Excluded from reports' : 'Included in reports'}</Value></View>
  </ScrollView>;
}
