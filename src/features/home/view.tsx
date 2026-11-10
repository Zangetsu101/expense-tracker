import { type ReactNode } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { formatActivityDay, formatMoney, transactionTitle } from '@/lib/transaction-format';
import { Skeleton } from '@/components/loading';
import type { HomeList } from './queries.ts';
import { RetryButton } from './cards.tsx';
import { theme } from '@/theme';

const colors = theme.colors;

export function HomeLayout({
  title,
  quickAddAccountId,
  accountsReady,
  children,
}: {
  title?: ReactNode;
  quickAddAccountId: number | null;
  accountsReady: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          ...(title ? { headerTitle: () => title } : {}),
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
            params: quickAddAccountId === null ? {} : { accountId: String(quickAddAccountId) },
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

/** Shows only after a refresh of the cached deck failed. It slides in under the title and out again. */
export function RefreshNotice({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  if (!failed) return null;
  return (
    <Animated.View
      entering={FadeInDown}
      exiting={FadeOutUp}
      style={{
        marginHorizontal: 20,
        marginBottom: 10,
        paddingLeft: 14,
        paddingRight: 6,
        borderRadius: 12,
        backgroundColor: 'rgba(244,201,152,0.12)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text accessibilityRole="alert" style={{ color: colors.warning, flex: 1 }}>
        Couldn’t refresh accounts
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry refresh"
        onPress={onRetry}
        style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' }}
      >
        <Text style={{ color: colors.accent, fontWeight: '700' }}>Retry</Text>
      </Pressable>
    </Animated.View>
  );
}

/** Opens search for the Account in view. It changes at once when the deck moves. */
export function SearchField({ accountId, name }: { accountId: number | null; name: string }) {
  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel={`Search ${name}`}
      onPress={() =>
        router.push({
          pathname: '/transactions',
          params: accountId === null ? {} : { accountId: String(accountId) },
        })
      }
      style={{
        minHeight: 48,
        borderRadius: 24,
        backgroundColor: colors.surface,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <SymbolView
        name={{ ios: 'magnifyingglass', android: 'search' }}
        size={20}
        tintColor={colors.muted}
      />
      <Text style={{ color: colors.muted, fontSize: 15 }}>Search {name}</Text>
    </Pressable>
  );
}

export function ActivityList({ list, muted = false }: { list: HomeList; muted?: boolean }) {
  const { accountId, rows, dailySummaries } = list;
  return (
    <View
      pointerEvents={muted ? 'none' : 'auto'}
      accessibilityElementsHidden={muted}
      importantForAccessibility={muted ? 'no-hide-descendants' : 'auto'}
      style={{ opacity: muted ? 0.4 : 1 }}
    >
      {rows.length === 0 && (
        <Text style={{ color: colors.muted, paddingVertical: 16 }}>
          {accountId === null
            ? 'No transactions yet. Add one to get started.'
            : 'No transactions in this account yet.'}
        </Text>
      )}
      {rows.map((item, index) => {
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
          <View key={item.id}>
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
      })}
    </View>
  );
}

export function ActivitySkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading activity"
      style={{ paddingTop: 12 }}
    >
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

export function ActivityError({ retry }: { retry: () => void }) {
  return (
    <View style={{ minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <Text accessibilityRole="alert" style={{ color: colors.muted }}>
        Couldn’t load account activity
      </Text>
      <RetryButton onPress={retry} />
    </View>
  );
}
