import { use, useState, useTransition } from 'react';
import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { Link, router, Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppSheet } from '@/components/app-sheet';
import { FormButton, FormInput } from '@/components/form-controls';
import { QueryBoundary } from '@/components/query-error-boundary';
import { QuickAddDate } from '@/components/quick-add-date';
import { parseRouteId } from '@/lib/account-selection';
import { parseOpeningBalance } from '@/lib/accounts';
import { epochDay } from '@/lib/database';
import {
  investmentHistory,
  investmentReturnTotals,
  recordValuation,
  type InvestmentHistoryRow,
} from '@/lib/investments';
import { QueryTimeContext } from '@/lib/query-time';
import { accountBalances } from '@/lib/reports';
import { formatBalance, formatEpochDay, formatSignedMoney } from '@/lib/transaction-format';
import { theme } from '@/theme';
import { accountsOverviewQuery } from './queries';
import { useAccountSheet } from './account-editor';
import { WriteError } from './view';

const c = theme.colors;
const historyLabels = { VALUATION: 'Valuation', INCOME: 'Dividend', TRANSFER: 'Transfer' };

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: c.muted }}>{label}</Text>
      <Text selectable style={{ color: c.text, flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

function ValuationActions({
  accountId,
  day,
  target,
  currency,
  pending,
  onSave,
}: {
  accountId: number;
  day: number;
  target: number | undefined;
  currency: string;
  pending: boolean;
  onSave: () => void;
}) {
  const { data, error, isFetching } = useSuspenseQuery({
    queryKey: ['accounts', 'balances', day],
    queryFn: () => accountBalances(day),
    // Retry a failed refresh even when the cached balance is still fresh.
    refetchOnMount: (query) => (query.state.status === 'error' ? 'always' : true),
  });
  if (error && !isFetching) throw error;
  const balance = data.find(({ id }) => id === accountId)?.balanceMinor;
  const delta = target !== undefined && balance !== undefined ? target - balance : undefined;
  return (
    <>
      {delta !== undefined && (
        <Metric label="Value change" value={formatSignedMoney(delta, currency)} />
      )}
      <FormButton
        label="Save value"
        loading={pending}
        disabled={!delta || isFetching}
        onPress={onSave}
      />
    </>
  );
}

function ValuationSheet({
  accountId,
  currency,
  balance,
  onClose,
}: {
  accountId: number;
  currency: string;
  balance: number;
  onClose: () => void;
}) {
  const [text, setText] = useState((balance / 100).toFixed(2));
  const [date, setDate] = useState(() => new Date());
  const [error, setError] = useState<string>();
  const [pending, startSave] = useTransition();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const day = epochDay(date);
  let target: number | undefined;
  let amountError: string | undefined;
  if (text.trim()) {
    try {
      const amount = parseOpeningBalance(text);
      if (amount < 0) amountError = 'Enter a value of zero or more.';
      else target = amount;
    } catch (cause) {
      amountError = String(cause);
    }
  }

  function save() {
    if (pending || target === undefined) return;
    const value = target;
    setError(undefined);
    startSave(async () => {
      try {
        await recordValuation(accountId, value, day);
        onClose();
      } catch (cause) {
        setError(String(cause));
      }
    });
  }

  return (
    <AppSheet pending={pending} onDismiss={onClose}>
      <ScrollView
        style={{ width, maxHeight: height * 0.82 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24, gap: 16 }}
      >
        <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>Update value</Text>
        <Text style={{ color: c.muted }}>New total in {currency}</Text>
        <FormInput
          accessibilityLabel="New total"
          value={text}
          onChangeText={(value) => {
            setText(value);
            setError(undefined);
          }}
          keyboardType="numbers-and-punctuation"
          editable={!pending}
        />
        <QuickAddDate value={date} onChange={setDate} disabled={pending} />
        {amountError && <WriteError message={amountError} />}
        {error && <WriteError message={error} />}
        <QueryBoundary
          key={day}
          pending={<Text style={{ color: c.muted }}>Loading balance…</Text>}
          error={(retry) => (
            <>
              <WriteError message="Could not load the balance." />
              <FormButton label="Retry balance" variant="secondary" onPress={retry} />
            </>
          )}
        >
          <ValuationActions
            accountId={accountId}
            day={day}
            target={target}
            currency={currency}
            pending={pending}
            onSave={save}
          />
        </QueryBoundary>
        <FormButton label="Cancel" variant="secondary" disabled={pending} onPress={onClose} />
      </ScrollView>
    </AppSheet>
  );
}

function HistoryRow({ row }: { row: InvestmentHistoryRow }) {
  return (
    <Link href={{ pathname: '/transaction/[id]', params: { id: String(row.id) } }} asChild>
      <Pressable
        accessibilityRole="link"
        style={{ padding: 14, backgroundColor: c.surface, borderRadius: 12, gap: 6 }}
      >
        <Metric
          label={historyLabels[row.kind]}
          value={formatSignedMoney(row.amountMinor, row.currencyCode)}
        />
        <Text style={{ color: c.muted, fontSize: 12 }}>
          {row.otherAccount ? `${row.otherAccount} · ` : ''}
          {formatEpochDay(row.date)}
        </Text>
      </Pressable>
    </Link>
  );
}

function InvestmentDetail({ id, today }: { id: number; today: number }) {
  const [{ data: overview }, history] = useSuspenseQueries({
    queries: [
      accountsOverviewQuery(today),
      {
        queryKey: ['accounts', 'investment', id, 'history'],
        queryFn: () => investmentHistory(id),
      },
    ],
  });
  const account = overview.accounts.find((item) => item.id === id && item.isInvestment);
  const metrics = overview.investments.find((item) => item.id === id);
  const accountSheet = useAccountSheet(overview.accounts);
  const [updating, setUpdating] = useState(false);
  const insets = useSafeAreaInsets();
  if (!account || !metrics)
    return <Text style={{ color: c.muted, padding: 20 }}>Investment not found.</Text>;
  const currency = account.currencyCode;
  const balance = overview.balances.get(id) ?? 0;
  const totalReturn = investmentReturnTotals(metrics, overview.rate)
    .map((row) => formatBalance(row.amountMinor, row.currencyCode))
    .join(' · ');
  const liquid = overview.accounts.filter((item) => !item.card && !item.isInvestment);
  const defaultCash = liquid.find((item) => item.isFavorite) ?? liquid[0];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen
        options={{
          title: account.name,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              onPress={() => accountSheet.edit(account)}
              style={{ padding: 8 }}
            >
              <Text style={{ color: c.accent, fontWeight: '600' }}>Edit</Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 8 }}
        data={history.data}
        keyExtractor={(row) => String(row.id)}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 8 }}>
            <View style={{ backgroundColor: c.raised, borderRadius: 20, padding: 20, gap: 12 }}>
              <Text style={{ color: c.muted }}>Current value</Text>
              <Text selectable style={{ color: c.accent, fontSize: 30, fontWeight: '700' }}>
                {formatBalance(balance, currency)}
              </Text>
              <Metric label="Invested" value={formatBalance(metrics.investedMinor, currency)} />
              <Metric label="Total return" value={totalReturn} />
              <Metric label="Value growth" value={formatBalance(metrics.growthMinor, currency)} />
              <Metric
                label="Dividends paid"
                value={
                  metrics.dividends.length
                    ? metrics.dividends
                        .map((row) => formatBalance(row.amountMinor, row.currencyCode))
                        .join(' · ')
                    : formatBalance(0, currency)
                }
              />
            </View>
            <FormButton label="Update value" onPress={() => setUpdating(true)} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <FormButton
                label="Dividend"
                disabled={!defaultCash}
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/quick-add',
                    params: {
                      mode: 'TRANSFER',
                      accountId: String(id),
                      dividend: '1',
                      ...(defaultCash && { toId: String(defaultCash.id) }),
                    },
                  })
                }
              />
              <FormButton
                label="Transfer"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/quick-add',
                    params: {
                      mode: 'TRANSFER',
                      toId: String(id),
                      ...(defaultCash && { accountId: String(defaultCash.id) }),
                    },
                  })
                }
              />
            </View>
            {!defaultCash && (
              <Text style={{ color: c.muted }}>Add a liquid Account to receive dividends.</Text>
            )}
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 18 }}>History</Text>
            {history.isError && !history.isFetching && (
              <FormButton
                label="Retry history"
                variant="secondary"
                onPress={() => void history.refetch()}
              />
            )}
          </View>
        }
        ListEmptyComponent={<Text style={{ color: c.muted }}>No activity yet.</Text>}
        renderItem={({ item }) => <HistoryRow row={item} />}
      />
      {accountSheet.sheet}
      {updating && (
        <ValuationSheet
          accountId={id}
          currency={currency}
          balance={balance}
          onClose={() => setUpdating(false)}
        />
      )}
    </View>
  );
}

export function InvestmentScreen() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const id = parseRouteId(accountId);
  const today = epochDay(use(QueryTimeContext));
  return (
    <QueryBoundary
      resetKey={`${id}-${today}`}
      pending={<Text style={{ color: c.muted, padding: 20 }}>Loading investment…</Text>}
      error={(retry) => <FormButton label="Retry investment" variant="secondary" onPress={retry} />}
    >
      {id ? (
        <InvestmentDetail id={id} today={today} />
      ) : (
        <Text style={{ color: c.muted, padding: 20 }}>Investment not found.</Text>
      )}
    </QueryBoundary>
  );
}
