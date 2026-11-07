import { type ComponentProps, type ReactNode } from 'react';
import { Link, Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import {
  formatActivityDay,
  formatBalance,
  formatMoney,
  transactionTitle,
} from '@/lib/transaction-format';
import { Skeleton } from './loading.tsx';
import { HomeAccountPicker, HomeAccountPickerSkeleton } from './account-picker.tsx';
import type { CurrencyBalance } from './balances.ts';
import type { HomeSnapshot } from './queries.ts';
import { theme } from '@/theme';

const colors = { ...theme.colors, panel: theme.colors.surface };

function BalanceAmount({ balance, fontSize }: { balance: CurrencyBalance; fontSize: number }) {
  return (
    <Text
      selectable
      style={{
        color: balance.balanceMinor < 0 ? colors.warning : colors.text,
        fontSize,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
      }}
    >
      {formatBalance(balance.balanceMinor, balance.currencyCode)}
    </Text>
  );
}

export function FinancialView({
  snapshot,
  muted = false,
}: {
  snapshot: HomeSnapshot;
  muted?: boolean;
}) {
  const accountId = snapshot.accountId;
  const rows = snapshot.rows;
  const balances = snapshot.balances;
  const summaries = snapshot.summaries;
  const dailySummaries = snapshot.dailySummaries;
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
      data={rows}
      keyExtractor={(row) => String(row.id)}
      ListHeaderComponent={
        <View style={{ gap: 20, paddingBottom: 12 }}>
          <View
            pointerEvents={muted ? 'none' : 'auto'}
            accessibilityElementsHidden={muted}
            importantForAccessibility={muted ? 'no-hide-descendants' : 'auto'}
            style={{ gap: 20, opacity: muted ? 0.4 : 1 }}
          >
            <View
              style={{
                backgroundColor: colors.panel,
                borderRadius: 16,
                borderCurve: 'continuous',
                padding: 18,
                gap: 12,
              }}
            >
              {balances.length > 0 && (
                <>
                  <View style={{ gap: 4 }}>
                    <Text style={{ color: colors.muted }}>Balance</Text>
                    {balances.length === 1 ? (
                      <BalanceAmount balance={balances[0]} fontSize={30} />
                    ) : (
                      balances.map((b) => (
                        <View
                          key={b.currencyCode}
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            gap: 12,
                          }}
                        >
                          <Text style={{ color: colors.muted, fontWeight: '700' }}>
                            {b.currencyCode}
                          </Text>
                          <BalanceAmount balance={b} fontSize={20} />
                        </View>
                      ))
                    )}
                  </View>
                  <View style={{ height: 1, backgroundColor: colors.line }} />
                </>
              )}
              <Text style={{ color: colors.muted }}>
                This month · excluding unreported transactions
              </Text>
              {summaries.length === 0 ? (
                <Text style={{ color: colors.text }}>No reportable activity this month</Text>
              ) : (
                summaries.map((summary) => (
                  <View key={summary.currencyCode} style={{ gap: 6 }}>
                    {summaries.length > 1 && (
                      <Text style={{ color: colors.muted, fontWeight: '700' }}>
                        {summary.currencyCode}
                      </Text>
                    )}
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 12,
                      }}
                    >
                      <View>
                        <Text style={{ color: colors.muted }}>Expenses</Text>
                        <Text
                          selectable
                          style={{
                            color: colors.text,
                            fontSize: 22,
                            fontWeight: '700',
                            fontVariant: ['tabular-nums'],
                          }}
                        >
                          {formatMoney('TRANSFER', summary.expenseMinor, summary.currencyCode)}
                        </Text>
                      </View>
                      <View>
                        <Text style={{ color: colors.muted }}>Income</Text>
                        <Text
                          selectable
                          style={{
                            color: colors.accent,
                            fontSize: 18,
                            fontVariant: ['tabular-nums'],
                          }}
                        >
                          {formatMoney('TRANSFER', summary.incomeMinor, summary.currencyCode)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>
                Recent activity
              </Text>
              <Link
                href={{
                  pathname: '/transactions',
                  params: accountId === null ? {} : { accountId: String(accountId) },
                }}
                asChild
              >
                <Pressable
                  disabled={muted}
                  accessibilityState={{ disabled: muted }}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}
                >
                  <Text style={{ color: colors.accent }}>
                    {accountId === null ? 'Search all' : 'Search account'}
                  </Text>
                </Pressable>
              </Link>
            </View>

            {rows.length === 0 && (
              <Text style={{ color: colors.muted }}>
                {accountId === null
                  ? 'No transactions yet. Add one to get started.'
                  : 'No transactions in this account. Add one or choose another account.'}
              </Text>
            )}
          </View>
        </View>
      }
      renderItem={({ item, index }) => {
        const title = transactionTitle(item);
        const scopedTransfer = item.type === 'TRANSFER' && accountId !== null;
        const incoming = scopedTransfer && item.transferAccountId === accountId;
        const detail = scopedTransfer
          ? incoming
            ? `Received from ${item.accountName}`
            : `Sent to ${item.transferAccountName}`
          : `${item.accountName}${item.transferAccountName ? ` → ${item.transferAccountName}` : ''}`;
        const displayAmount = scopedTransfer
          ? `${incoming ? '+' : '−'}${formatMoney('TRANSFER', item.amountMinor, item.currencyCode)}`
          : formatMoney(item.type, item.amountMinor, item.currencyCode);
        return (
          <View
            pointerEvents={muted ? 'none' : 'auto'}
            accessibilityElementsHidden={muted}
            importantForAccessibility={muted ? 'no-hide-descendants' : 'auto'}
            style={{ opacity: muted ? 0.4 : 1 }}
          >
            {(index === 0 || rows[index - 1].date !== item.date) && (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 8,
                  paddingTop: 16,
                  paddingBottom: 4,
                }}
              >
                <Text style={{ color: colors.muted, fontWeight: '700' }}>
                  {formatActivityDay(item.date)}
                </Text>
                <View style={{ flexShrink: 1, gap: 4 }}>
                  {dailySummaries
                    .filter(
                      (summary) =>
                        summary.date === item.date &&
                        (summary.expenseMinor !== 0 || summary.incomeMinor !== 0),
                    )
                    .map((summary) => (
                      <View
                        key={summary.currencyCode}
                        style={{
                          flexDirection: 'row',
                          flexWrap: 'wrap',
                          justifyContent: 'flex-end',
                          gap: 12,
                        }}
                      >
                        {summary.expenseMinor !== 0 && (
                          <Text
                            selectable
                            style={{
                              color: colors.muted,
                              fontSize: 12,
                              fontVariant: ['tabular-nums'],
                            }}
                          >
                            Spent{' '}
                            {formatMoney('TRANSFER', summary.expenseMinor, summary.currencyCode)}
                          </Text>
                        )}
                        {summary.incomeMinor !== 0 && (
                          <Text
                            selectable
                            style={{
                              color: colors.accent,
                              fontSize: 12,
                              fontVariant: ['tabular-nums'],
                            }}
                          >
                            Earned{' '}
                            {formatMoney('TRANSFER', summary.incomeMinor, summary.currencyCode)}
                          </Text>
                        )}
                      </View>
                    ))}
                </View>
              </View>
            )}
            <Pressable
              disabled={muted}
              accessibilityState={{ disabled: muted }}
              onPress={() =>
                router.push({ pathname: '/transaction/[id]', params: { id: String(item.id) } })
              }
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${item.accountName}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 16,
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text selectable style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
                  {title}
                </Text>
                <Text selectable style={{ color: colors.muted }}>
                  {detail}
                  {item.note ? ` · ${item.note}` : ''}
                </Text>
              </View>
              <Text
                selectable
                style={{
                  color: item.type === 'INCOME' || incoming ? colors.accent : colors.text,
                  fontWeight: '700',
                  fontVariant: ['tabular-nums'],
                }}
              >
                {displayAmount}
              </Text>
            </Pressable>
          </View>
        );
      }}
    />
  );
}

export function HomeLayout({
  accountId,
  accountsReady,
  children,
}: {
  accountId: number | null;
  accountsReady: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              style={{
                minWidth: 48,
                minHeight: 48,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SymbolView
                name={{ ios: 'gearshape', android: 'settings' }}
                size={26}
                tintColor={colors.text}
              />
            </Pressable>
          ),
        }}
      />
      <StatusBar style="light" />
      {children}
      <Pressable
        onPress={() =>
          router.push({
            pathname: '/quick-add',
            params: accountId === null ? {} : { accountId: String(accountId) },
          })
        }
        disabled={!accountsReady}
        accessibilityState={{ disabled: !accountsReady }}
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
        style={({ pressed }) => ({
          position: 'absolute',
          right: 20,
          bottom: 16,
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.75 : 1,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        })}
      >
        <SymbolView
          name={{ ios: 'plus', android: 'add' }}
          size={30}
          tintColor={colors.background}
        />
      </Pressable>
    </View>
  );
}
function LoadingSummary() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading Home" style={{ gap: 12 }}>
      <Text style={{ color: colors.muted }}>Balance</Text>
      <Skeleton width="60%" height={36} />
      <View style={{ height: 1, backgroundColor: colors.line }} />
      <Text style={{ color: colors.muted }}>This month · excluding unreported transactions</Text>
      <View style={{ flexDirection: 'row', gap: 28 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={{ color: colors.muted }}>Expenses</Text>
          <Skeleton width="90%" height={26} />
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={{ color: colors.muted }}>Income</Text>
          <Skeleton width="75%" height={22} />
        </View>
      </View>
    </View>
  );
}
function LoadingRows() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2, 3].map((key) => (
        <View
          key={key}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 20,
            paddingVertical: 16,
            borderBottomWidth: 1,
            borderBottomColor: colors.line,
          }}
        >
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="65%" height={18} />
            <Skeleton width="45%" />
          </View>
          <Skeleton width={68} height={18} />
        </View>
      ))}
    </View>
  );
}
function FinancialFallback({
  accountId,
  summary,
  activity,
}: {
  accountId: number | null;
  summary: ReactNode;
  activity?: ReactNode;
}) {
  return (
    <FlatList
      data={[]}
      renderItem={() => null}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
      ListHeaderComponent={
        <View style={{ gap: 20, paddingBottom: 12 }}>
          <View
            style={{
              backgroundColor: colors.panel,
              borderRadius: 16,
              borderCurve: 'continuous',
              padding: 18,
              gap: 12,
            }}
          >
            {summary}
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>
              Recent activity
            </Text>
            <Text style={{ color: colors.accent, padding: 8, opacity: 0.4 }}>
              {accountId === null ? 'Search all' : 'Search account'}
            </Text>
          </View>
          {activity}
        </View>
      }
    />
  );
}
export function FinancialSkeleton({ accountId }: { accountId: number | null }) {
  return (
    <FinancialFallback
      accountId={accountId}
      summary={<LoadingSummary />}
      activity={<LoadingRows />}
    />
  );
}
export function FinancialError({
  accountId,
  retry,
  message = 'Couldn’t load account activity',
}: {
  accountId: number | null;
  retry: () => void;
  message?: string;
}) {
  return (
    <FinancialFallback
      accountId={accountId}
      summary={
        <View style={{ minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Text accessibilityRole="alert" style={{ color: colors.muted }}>
            {message}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={retry}
            style={{
              minHeight: 48,
              paddingHorizontal: 20,
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.warning,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: colors.warning }}>Retry</Text>
          </Pressable>
        </View>
      }
    />
  );
}

const accountSelectionStyle = { padding: 20, paddingBottom: 0 };

export function AccountSelection(props: ComponentProps<typeof HomeAccountPicker>) {
  return (
    <View style={accountSelectionStyle}>
      <HomeAccountPicker {...props} />
    </View>
  );
}

function HomeScreenFallback({ loading, children }: { loading: boolean; children: ReactNode }) {
  return (
    <HomeLayout accountId={null} accountsReady={false}>
      <View style={accountSelectionStyle}>
        <HomeAccountPickerSkeleton animated={loading} />
      </View>
      {children}
    </HomeLayout>
  );
}

export function HomeScreenSkeleton() {
  return (
    <HomeScreenFallback loading>
      <FinancialSkeleton accountId={null} />
    </HomeScreenFallback>
  );
}

export function HomeScreenError({ retry }: { retry: () => void }) {
  return (
    <HomeScreenFallback loading={false}>
      <FinancialError accountId={null} retry={retry} message="Couldn’t load Home" />
    </HomeScreenFallback>
  );
}
