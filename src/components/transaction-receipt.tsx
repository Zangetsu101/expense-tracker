import { savedTransferRate, formatTransferRate } from '@/lib/transfer-amounts';
import { useState } from 'react';
import { Link } from 'expo-router';
import type { WriteOffEntry } from '@/lib/lending';
import { lendingKindLabels } from '@/lib/lending-labels';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { EditableTransaction } from '@/lib/transaction-edit';
import type { EditableTransfer } from '@/lib/transfers';
import {
  formatEpochDay,
  formatActivityDay,
  formatBalance,
  formatMoney,
  formatTransactionAmount,
  transactionTitle,
} from '@/lib/transaction-format';
import { formatLineItemAmount } from '@/lib/line-item-amount';
import { theme } from '@/theme';

const color = { ...theme.colors, panel: theme.colors.surface, ink: theme.colors.text };
type Props = { transaction: EditableTransaction | WriteOffEntry };
function Label({ children }: { children: string }) {
  return (
    <Text
      style={{ color: color.muted, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}
    >
      {children}
    </Text>
  );
}
function Value({ children, muted = false }: { children: string; muted?: boolean }) {
  return (
    <Text selectable style={{ color: muted ? color.muted : color.ink, fontSize: 16 }}>
      {children}
    </Text>
  );
}
function ItemRows({ row, limit }: { row: EditableTransaction; limit?: number }) {
  return (
    <View style={{ gap: 12 }}>
      {row.lineItems.slice(0, limit).map((item, index) => (
        <View
          key={item.id ?? index}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 12,
            paddingBottom: 10,
            borderBottomWidth: 1,
            borderColor: color.line,
          }}
        >
          <Text selectable style={{ color: color.ink, flex: 1 }}>
            {item.name}
            {item.quantity != null ? ` × ${item.quantity}` : ''}
          </Text>
          <Text selectable style={{ color: color.ink, fontVariant: ['tabular-nums'] }}>
            {formatLineItemAmount(item.amountMinor)} {row.currencyCode}
          </Text>
        </View>
      ))}
    </View>
  );
}
function ItemSection({ row }: { row: EditableTransaction }) {
  const [open, setOpen] = useState(false);
  const count = row.lineItems.length;
  return (
    <View style={{ backgroundColor: color.panel, borderRadius: 16, padding: 18, gap: 14 }}>
      <Label>{`Line Items · ${count}`}</Label>
      {!count ? (
        <Value muted>No line items</Value>
      ) : (
        <>
          <ItemRows row={row} limit={open ? undefined : 2} />
          {count > 2 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={open ? 'Show fewer line items' : `Show all ${count} line items`}
              accessibilityState={{ expanded: open }}
              onPress={() => setOpen(!open)}
              style={{ paddingVertical: 10 }}
            >
              <Text style={{ color: color.accent, fontWeight: '600' }}>
                {open ? 'Show fewer' : `Show all ${count} items`}
              </Text>
            </Pressable>
          )}
        </>
      )}
      <Text style={{ color: color.muted, fontSize: 12 }}>
        Line Items do not change the Transaction amount.
      </Text>
    </View>
  );
}
function receiptAmount(row: Props['transaction']) {
  if (row.type === 'WRITE_OFF') return formatBalance(row.amountMinor, row.currencyCode);
  const format = row.lendingKind ? formatMoney : formatTransactionAmount;
  return format(row.type, row.amountMinor, row.currencyCode);
}
export function TransactionReceipt({ transaction: row }: Props) {
  const writeOff = row.type === 'WRITE_OFF';
  const kind = writeOff ? row.kind : row.lendingKind;
  const label = writeOff
    ? 'Write-off'
    : kind
      ? lendingKindLabels[kind]
      : row.type === 'EXPENSE'
        ? 'Expense'
        : 'Income';
  const title = writeOff
    ? row.kind === 'WRITE_OFF_LENT'
      ? `Wrote off what ${row.personName} owes`
      : `Wrote off what you owe ${row.personName}`
    : transactionTitle(row);
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: color.background }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32, gap: 24 }}
    >
      <View style={{ backgroundColor: color.panel, borderRadius: 18, padding: 22, gap: 16 }}>
        <Label>{`${label} · ${row.currencyCode}`}</Label>
        <Text
          selectable
          style={{
            color: writeOff ? color.muted : row.type === 'INCOME' ? color.accent : color.ink,
            fontSize: 40,
            fontWeight: '300',
            fontVariant: ['tabular-nums'],
          }}
        >
          {receiptAmount(row)}
        </Text>
        <Text selectable style={{ color: color.ink, fontSize: 20, fontWeight: '700' }}>
          {title}
        </Text>
        <View style={{ height: 1, backgroundColor: color.line }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
          <View style={{ gap: 8 }}>
            <Label>Account</Label>
            <Value muted={writeOff}>{row.accountName ?? 'No Account movement'}</Value>
          </View>
          <View style={{ gap: 8 }}>
            <Label>Date</Label>
            <Value>{kind ? formatActivityDay(row.date) : formatEpochDay(row.date)}</Value>
          </View>
        </View>
      </View>
      {!!row.personId && !!row.personName && (
        <View style={{ gap: 8 }}>
          <Label>Person</Label>
          <Link
            href={{
              pathname: '/person',
              params: { id: row.personId, name: row.personName },
            }}
            style={{ color: color.accent, fontSize: 16 }}
          >
            {row.personName} ›
          </Link>
        </View>
      )}
      <View style={{ gap: 8 }}>
        <Label>Note</Label>
        <Value muted={!row.note}>{row.note || 'No note'}</Value>
      </View>
      {!writeOff && (
        <>
          {(!kind || !!row.tags.length) && (
            <View style={{ gap: 8 }}>
              <Label>Tags</Label>
              <Value muted={!row.tags.length}>
                {row.tags.map((tag) => `#${tag.name}`).join('  ') || 'No tags'}
              </Value>
            </View>
          )}
          {(!kind || !!row.lineItems.length) && <ItemSection row={row} />}
          <View style={{ gap: 8 }}>
            <Label>Reports</Label>
            <Value>
              {row.excludeFromReport || row.reportExclusionLocked
                ? 'Excluded from reports'
                : 'Included in reports'}
            </Value>
          </View>
        </>
      )}
    </ScrollView>
  );
}
export function TransferReceipt({ transfer: row }: { transfer: EditableTransfer }) {
  const cross = row.currencyCode !== row.destinationCurrencyCode;
  const received = row.receivedAmountMinor ?? row.amountMinor;
  const rate = cross
    ? savedTransferRate({
        paid: row.amountMinor,
        received,
        source: row.currencyCode,
        destination: row.destinationCurrencyCode,
      })
    : null;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: color.background }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32, gap: 24 }}
    >
      <View style={{ backgroundColor: color.panel, borderRadius: 18, padding: 22, gap: 16 }}>
        <Label>{`Transfer · ${row.currencyCode}${cross ? ` → ${row.destinationCurrencyCode}` : ''}`}</Label>
        <Text
          selectable
          style={{
            color: color.ink,
            fontSize: 40,
            fontWeight: '300',
            fontVariant: ['tabular-nums'],
          }}
        >
          {formatTransactionAmount('TRANSFER', row.amountMinor, row.currencyCode)}
        </Text>
        {cross && (
          <Text selectable style={{ color: color.ink, fontSize: 20 }}>
            {formatTransactionAmount('TRANSFER', received, row.destinationCurrencyCode)} received
          </Text>
        )}
        <Text
          selectable
          style={{ color: color.ink, fontSize: 20, fontWeight: '700' }}
        >{`${row.fromAccountName} → ${row.toAccountName}`}</Text>
        <View style={{ height: 1, backgroundColor: color.line }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
          <View style={{ gap: 8 }}>
            <Label>From</Label>
            <Value>{row.fromAccountName}</Value>
          </View>
          <View style={{ gap: 8 }}>
            <Label>To</Label>
            <Value>{row.toAccountName}</Value>
          </View>
          {rate && (
            <View style={{ gap: 8 }}>
              <Label>Rate</Label>
              <Value>{`1 ${rate.base} = ${formatTransferRate(rate.rate)} ${rate.quote}`}</Value>
            </View>
          )}
          <View style={{ gap: 8 }}>
            <Label>Date</Label>
            <Value>{formatEpochDay(row.date)}</Value>
          </View>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Label>Note</Label>
        <Value muted={!row.note}>{row.note || 'No note'}</Value>
      </View>
    </ScrollView>
  );
}
