import { useState, type ReactNode } from 'react';
import { Link, router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { categoryPath, expenseDetail, rowView, type ListRow } from '@/features/home/list';
import { TransactionRow } from '@/features/home/list-view';
import { shortDay } from '@/features/home/period';
import type { reimbursementReceipt } from '@/features/home/read-home';
import { formatMoney } from '@/lib/transaction-format';
import { reimbursementTitle } from '@/lib/reimbursements';
import { theme } from '@/theme';

export type ReimbursementDetails = Awaited<ReturnType<typeof reimbursementReceipt>>;
const c = theme.colors;
const scope = { face: 'pace', accountId: null } as const;
const href = (id: number) => ({
  pathname: '/transaction/[id]' as const,
  params: { id: String(id) },
});

function Panel({ children }: { children: ReactNode }) {
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 16, padding: 18, gap: 12 }}>
      {children}
    </View>
  );
}

function Caption({ children }: { children: string }) {
  return (
    <Text style={{ color: c.muted, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
      {children}
    </Text>
  );
}

function cellColor(header: boolean | undefined, index: number) {
  if (header) return c.muted;
  return index === 2 ? c.accent : c.text;
}

function SplitRow({
  cells,
  header,
  total,
}: {
  cells: string[];
  header?: boolean;
  total?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 6,
        paddingBottom: total ? 0 : 10,
        borderBottomWidth: total ? 0 : 1,
        borderColor: c.line,
      }}
    >
      {cells.map((cell, index) => (
        <Text
          key={index}
          style={{
            flex: index === 0 ? 1.25 : 1,
            textAlign: index === 0 ? 'left' : 'right',
            color: cellColor(header, index),
            fontSize: header ? 11 : 14,
            fontWeight: total ? '700' : '400',
            fontVariant: ['tabular-nums'],
          }}
        >
          {cell}
        </Text>
      ))}
    </View>
  );
}

function SplitTable({
  shares,
  payments,
  amount,
  currency,
}: {
  shares: ReimbursementDetails['shares'];
  payments: ReimbursementDetails['payments'];
  amount: number;
  currency: string;
}) {
  const yours = amount - shares.reduce((sum, s) => sum + s.amountMinor, 0);
  const left = shares.reduce((sum, s) => sum + s.leftMinor, 0);
  const paid = payments.reduce((sum, p) => sum + p.amountMinor, 0);
  const refunds = payments.reduce(
    (sum, p) => sum + (p.reimbursement?.personName ? 0 : p.amountMinor),
    0,
  );
  const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
  const value = (minor: number) => number.format(minor / 100);
  const back = (minor: number) => (minor ? value(minor) : '–');
  const remaining = (minor: number) => (minor ? value(minor) : '✓');
  return (
    <Panel>
      <Caption>{`Split · ${currency}`}</Caption>
      <SplitRow header cells={['Person', 'Share', 'Back', 'Left']} />
      {shares.map((share) => (
        <SplitRow
          key={share.personId}
          cells={[
            share.name,
            value(share.amountMinor),
            back(share.paidMinor),
            remaining(share.leftMinor),
          ]}
        />
      ))}
      <SplitRow cells={['You', value(yours), '', '']} />
      {!!refunds && <SplitRow cells={['Refund', '', back(refunds), '']} />}
      <SplitRow total cells={['Total', value(amount), back(paid), remaining(left)]} />
      <Text style={{ color: c.muted, fontSize: 12 }}>
        Your Account shows the full {formatMoney('EXPENSE', amount, currency)}. Reimbursements are
        separate Transactions.
      </Text>
    </Panel>
  );
}

export function ExpenseReimbursementPanels({
  details,
  amount,
  currency,
}: {
  details: ReimbursementDetails;
  amount: number;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const { shares, payments } = details;
  if (!shares.length && !payments.length) return null;
  const label = `Reimbursements · ${payments.length}`;
  return (
    <>
      {!!shares.length && (
        <SplitTable shares={shares} payments={payments} amount={amount} currency={currency} />
      )}
      <Panel>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            minHeight: 36,
          }}
        >
          <Caption>{label}</Caption>
          <Text style={{ color: c.muted }}>{open ? '⌄' : '›'}</Text>
        </Pressable>
        {open &&
          (payments.length ? (
            payments.map((payment) => (
              <Link key={payment.id} href={href(payment.id)} push asChild>
                <Pressable
                  accessibilityRole="link"
                  style={{ gap: 4, paddingBottom: 10, borderBottomWidth: 1, borderColor: c.line }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ flex: 1, color: c.accent }}>
                      {reimbursementTitle(payment.reimbursement?.personName)} ›
                    </Text>
                    <Text style={{ color: c.text, fontVariant: ['tabular-nums'] }}>
                      {formatMoney('INCOME', payment.amountMinor, payment.currencyCode)}
                    </Text>
                  </View>
                  <Text style={{ color: c.muted, fontSize: 12 }}>
                    {shortDay(payment.date)} · {payment.accountName}
                  </Text>
                </Pressable>
              </Link>
            ))
          ) : (
            <Text style={{ color: c.muted }}>
              None yet. Add one from Add › Income › Link to expense.
            </Text>
          ))}
      </Panel>
    </>
  );
}

export function ReimbursedExpense({ expense }: { expense: ListRow }) {
  return (
    <View style={{ gap: 8 }}>
      <Caption>Reimbursement for</Caption>
      <View style={{ backgroundColor: c.surface, borderRadius: 16, paddingHorizontal: 14 }}>
        <TransactionRow.Layout
          view={{
            ...rowView(expense, scope),
            detail: expenseDetail(expense),
            title: categoryPath(expense),
            owed: undefined,
          }}
          query=""
          disabled={false}
          onPress={() => router.push(href(expense.id))}
        >
          <TransactionRow.Chevron />
        </TransactionRow.Layout>
      </View>
    </View>
  );
}
