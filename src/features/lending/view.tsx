import type { ReactElement, ReactNode } from 'react';
import { router } from 'expo-router';
import { BottomSheet, RNHostView } from '@expo/ui';
import { interactiveDismissDisabled } from '@expo/ui/swift-ui/modifiers';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  SectionList,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QueryBoundary } from '@/components/query-error-boundary';
import { Skeleton } from '@/components/loading';
import { formatActivityDay, formatBalance, formatMoney } from '@/lib/transaction-format';
import type { LendingEntry, LendingTotal, UnassignedLendingTransaction } from '@/lib/lending';
import { lendingKindLabels } from '@/lib/lending-labels';
import { theme } from '@/theme';

export const c = theme.colors;
export const panel = { backgroundColor: c.surface, borderRadius: 16, padding: 18, gap: 12 };
export const line = { height: 1, backgroundColor: c.line };
export const two = { flexDirection: 'row', justifyContent: 'space-between', gap: 12 } as const;
export function personRoute(id: number, name: string) {
  return { pathname: '/accounts/lending/person' as const, params: { id: String(id), name } };
}

export function directionColor(direction: LendingTotal['direction']) {
  return direction === 'LENT' ? c.accent : c.warning;
}

export function askOverpayment(warnings: LendingTotal[], action: string) {
  return new Promise<boolean>((resolve) =>
    Alert.alert(
      'Overpayment warning',
      warnings
        .map(
          (w) =>
            `${w.direction === 'LENT' ? 'Owes you' : 'You owe'} · Overpaid credit ${formatBalance(w.overpaidMinor, w.currencyCode)}`,
        )
        .join('\n'),
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: action, onPress: () => resolve(true) },
      ],
      { cancelable: false },
    ),
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ color: c.muted }}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>
      {children}
    </Text>
  );
}

export function LendingAlert({
  message,
  retry,
  refresh = false,
}: {
  message: string;
  retry: () => void;
  refresh?: boolean;
}) {
  return (
    <View
      style={
        refresh
          ? {
              ...two,
              alignItems: 'center',
              backgroundColor: `${c.warning}1f`,
              borderRadius: 12,
              paddingLeft: 14,
            }
          : { alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 220 }
      }
    >
      <Text
        accessibilityRole="alert"
        style={{ color: refresh ? c.warning : c.muted, flexShrink: 1 }}
      >
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={({ pressed }) => ({
          justifyContent: 'center',
          minHeight: 44,
          borderRadius: theme.radius.control,
          borderWidth: refresh ? 0 : 1,
          borderColor: c.warning,
          paddingHorizontal: refresh ? 12 : 16,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ color: refresh ? c.accent : c.warning, fontWeight: '600' }}>Retry</Text>
      </Pressable>
    </View>
  );
}

export function LendingScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 90, gap: 16 }}
    >
      {children}
    </ScrollView>
  );
}

export function LendingBoundary({
  title,
  section,
  subject,
  children,
}: {
  title: string;
  section: string;
  subject: string;
  children: ReactNode;
}) {
  return (
    <QueryBoundary
      pending={
        <LendingScroll>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={`Loading ${title}`}
            style={{ gap: 16 }}
          >
            <View style={panel}>
              <Skeleton width="40%" />
              <Skeleton width="65%" height={28} />
              <View style={line} />
              <Skeleton width="55%" />
            </View>
            <Heading>{section}</Heading>
            {[0, 1, 2, 3].map((row) => (
              <View key={row} style={rowStyle}>
                <Skeleton width={40} height={40} borderRadius={12} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Skeleton width="65%" height={18} />
                  <Skeleton width="45%" />
                </View>
                <Skeleton width={68} height={18} />
              </View>
            ))}
          </View>
        </LendingScroll>
      }
      error={(retry) => (
        <LendingScroll>
          <LendingAlert message={`Could not load ${subject}`} retry={retry} />
        </LendingScroll>
      )}
    >
      {children}
    </QueryBoundary>
  );
}

export function EmptyLedger({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ minHeight: 360, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
      <Text style={{ color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>
        {title}
      </Text>
      {hint && <Text style={{ color: c.muted, textAlign: 'center' }}>{hint}</Text>}
    </View>
  );
}

export function AddEntryButton({ personId }: { personId?: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add entry"
      onPress={() =>
        router.push({
          pathname: '/quick-add',
          params: personId === undefined ? { mode: 'PERSON' } : { mode: 'PERSON', personId },
        })
      }
      style={{
        position: 'absolute',
        right: 20,
        bottom: 16,
        width: 60,
        height: 60,
        borderRadius: 30,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.accent,
        elevation: 4,
      }}
    >
      <Text style={{ color: c.background, fontSize: 32 }}>+</Text>
    </Pressable>
  );
}

const rowStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  minHeight: 68,
  paddingVertical: 10,
  borderBottomWidth: 1,
  borderColor: c.line,
} as const;

export function LedgerRow({
  title,
  detail,
  icon,
  amounts,
  onPress,
  checked,
  settled,
  dashed,
}: {
  title: string;
  detail?: string;
  icon: string;
  amounts?: ReactNode;
  onPress: () => void;
  checked?: boolean;
  settled?: boolean;
  dashed?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={checked === undefined ? 'button' : 'checkbox'}
      accessibilityLabel={[title, detail].filter(Boolean).join(', ')}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={({ pressed }) => [rowStyle, { opacity: pressed ? 0.6 : 1 }]}
    >
      {checked === undefined ? (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: dashed ? 'transparent' : c.raised,
            borderColor: c.line,
            borderWidth: dashed ? 1 : 0,
            borderStyle: dashed ? 'dashed' : 'solid',
          }}
        >
          <Text style={{ color: dashed ? c.muted : c.text, fontSize: 18, fontWeight: '700' }}>
            {icon}
          </Text>
        </View>
      ) : (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: checked ? c.accent : c.line,
            backgroundColor: checked ? c.accent : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: c.background }}>{checked ? '✓' : ''}</Text>
        </View>
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: settled ? c.muted : c.text, fontSize: 16, fontWeight: '600' }}>
          {title}
        </Text>
        {!!detail && <Muted>{detail}</Muted>}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>{amounts}</View>
    </Pressable>
  );
}

export function MoneyText({
  children,
  color = c.text,
  size = 14,
}: {
  children: ReactNode;
  color?: string;
  size?: number;
}) {
  return (
    <Text
      style={{
        color,
        fontSize: size,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
        textAlign: 'right',
      }}
    >
      {children}
    </Text>
  );
}

export function BalanceAmounts({ totals }: { totals: LendingTotal[] }) {
  return totals
    .filter((t) => t.outstandingMinor > 0)
    .sort((a, b) => b.direction.localeCompare(a.direction))
    .map((t) => (
      <MoneyText key={`${t.direction}:${t.currencyCode}`} color={directionColor(t.direction)}>
        {formatBalance(t.outstandingMinor, t.currencyCode)}
      </MoneyText>
    ));
}

type HistoryEntry = LendingEntry | UnassignedLendingTransaction;

export function HistoryList<T extends HistoryEntry>({
  rows,
  header,
  onPress,
  selection,
}: {
  rows: T[];
  header: ReactElement;
  onPress: (row: T) => void;
  selection?: ReadonlySet<number>;
}) {
  const days = new Map<number, T[]>();
  for (const row of rows) {
    const entries = days.get(row.date) ?? [];
    entries.push(row);
    days.set(row.date, entries);
  }
  return (
    <SectionList
      style={{ flex: 1 }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 100 }}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      sections={[...days].map(([date, data]) => ({ date, data, key: String(date) }))}
      keyExtractor={(row) => String('id' in row ? row.id : row.transactionId)}
      renderSectionHeader={({ section }) => (
        <Text style={{ color: c.muted, fontWeight: '700', paddingTop: 16, paddingBottom: 6 }}>
          {formatActivityDay(section.date)}
        </Text>
      )}
      renderItem={({ item }) => {
        const writeOff = item.transactionId === null;
        const incoming = item.kind === 'BORROW' || item.kind === 'RECEIVE_REPAYMENT';
        const detail = [
          item.accountName ?? 'No Account movement',
          'categoryName' in item ? item.categoryName : null,
          item.note,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <LedgerRow
            title={lendingKindLabels[item.kind]}
            detail={detail}
            icon={writeOff ? '✕' : incoming ? '↙' : '↗'}
            checked={
              selection
                ? item.transactionId !== null && selection.has(item.transactionId)
                : undefined
            }
            onPress={() => onPress(item)}
            amounts={
              <MoneyText color={writeOff ? c.muted : incoming ? c.accent : c.text}>
                {formatMoney(
                  writeOff ? 'TRANSFER' : incoming ? 'INCOME' : 'EXPENSE',
                  item.amountMinor,
                  item.currencyCode,
                )}
              </MoneyText>
            }
          />
        );
      }}
    />
  );
}

export function LedgerSheet({
  children,
  dismiss,
  pending = false,
}: {
  children: ReactNode;
  dismiss: () => void;
  pending?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <BottomSheet
      isPresented
      onDismiss={() => {
        if (!pending) dismiss();
      }}
      shouldDismissOnBackPress={!pending}
      shouldDismissOnClickOutside={!pending}
      containerColor={c.surface}
      contentPadding={0}
      showDragIndicator={!pending}
      modifiers={process.env.EXPO_OS === 'ios' ? [interactiveDismissDisabled(pending)] : undefined}
    >
      <RNHostView matchContents>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ backgroundColor: c.surface, width, maxHeight: height * 0.75 }}
          contentContainerStyle={{
            padding: 20,
            paddingBottom: Math.max(20, insets.bottom),
            gap: 12,
          }}
        >
          {children}
        </ScrollView>
      </RNHostView>
    </BottomSheet>
  );
}

export function SheetAction({
  label,
  onPress,
  accent,
  disabled,
}: {
  label: string;
  onPress: () => void;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 48, justifyContent: 'center', borderBottomWidth: 1, borderColor: c.line }}
    >
      <Text style={{ color: accent ? c.accent : c.text, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

export function LendingButton({
  label,
  onPress,
  disabled = false,
  pending = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  const blocked = disabled || pending;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy: pending }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.controlHeight,
        paddingHorizontal: 18,
        borderRadius: theme.radius.control,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.accent,
        opacity: blocked ? 0.45 : pressed ? 0.65 : 1,
      })}
    >
      {pending ? (
        <ActivityIndicator color={c.background} />
      ) : (
        <Text style={{ color: c.background, fontWeight: '700', fontSize: 16 }}>{label}</Text>
      )}
    </Pressable>
  );
}
