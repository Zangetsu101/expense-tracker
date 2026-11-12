import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ManagedAccount } from '@/lib/accounts';
import { countLabel, formatBalance } from '@/lib/transaction-format';
import { AppSheet } from '@/components/app-sheet';
import { FormButton, FormInput } from '@/components/form-controls';
import { Skeleton } from '@/components/loading';
import { theme } from '@/theme';
import type { AccountsOverview } from './queries.ts';

const colors = {
  ...theme.colors,
  bg: theme.colors.background,
  ink: theme.colors.text,
  negative: theme.colors.warning,
};

export type AccountForm = { name: string; currencyCode: string; openingBalance: string };

export function AccountsLayout({ sheet, children }: { sheet: ReactNode; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 18 }}
      >
        {children}
      </ScrollView>
      {sheet}
    </View>
  );
}

function groupByCurrency(accounts: ManagedAccount[]) {
  const groups = new Map<string, ManagedAccount[]>();
  for (const account of accounts) {
    const group = groups.get(account.currencyCode) ?? [];
    group.push(account);
    groups.set(account.currencyCode, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function OverviewCard({ children }: { children: ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.raised, borderRadius: 20, padding: 20, gap: 8 }}>
      <Text style={{ color: colors.muted }}>Balance overview</Text>
      {children}
      <Text style={{ color: colors.muted, fontSize: 12 }}>Totals are separate by currency</Text>
    </View>
  );
}

export function BalanceOverview({ overview }: { overview: AccountsOverview }) {
  return (
    <OverviewCard>
      {groupByCurrency(overview.accounts).map(([code, group]) => {
        const total = group.reduce(
          (sum, account) => sum + (overview.balances.get(account.id) ?? 0),
          0,
        );
        return (
          <Text
            key={code}
            selectable
            style={{
              color: total < 0 ? colors.negative : colors.ink,
              fontSize: 26,
              fontWeight: '700',
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatBalance(total, code)}
          </Text>
        );
      })}
    </OverviewCard>
  );
}

/** The header row. Without a count it is part of the skeleton and of the error fallback. */
export function AccountsHeader({
  count,
  pending,
  onAdd,
}: {
  count?: number;
  pending: boolean;
  onAdd: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <Text style={{ color: colors.ink, fontSize: 21, fontWeight: '700', flexShrink: 1 }}>
        {count === undefined ? 'Accounts' : `Accounts (${count})`}
      </Text>
      <FormButton label="Add account" variant="secondary" disabled={pending} onPress={onAdd} />
    </View>
  );
}

export function RefreshAlert({ retry }: { retry: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text accessibilityRole="alert" style={{ flex: 1, color: colors.negative }}>
        Could not refresh accounts.
      </Text>
      <FormButton label="Retry" variant="secondary" onPress={retry} />
    </View>
  );
}

export function WriteError({ message }: { message: string }) {
  return (
    <Text selectable accessibilityRole="alert" style={{ color: colors.negative }}>
      {message}
    </Text>
  );
}

function GroupTitle({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.accent, fontSize: 17, fontWeight: '700' }}>{children}</Text>;
}

function AccountRow({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: colors.line,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 76,
      }}
    >
      {children}
    </View>
  );
}

export function AccountGroups({
  overview,
  disabled,
  onFavorite,
}: {
  overview: AccountsOverview;
  disabled: boolean;
  onFavorite: (id: number) => void;
}) {
  if (overview.accounts.length === 0)
    return <Text style={{ color: colors.muted }}>No accounts yet.</Text>;
  return groupByCurrency(overview.accounts).map(([code, group]) => (
    <View key={code} style={{ gap: 8 }}>
      <GroupTitle>
        {code} · {countLabel(group.length, 'account', 'accounts')}
      </GroupTitle>
      {group.map((account) => {
        const balance = overview.balances.get(account.id) ?? 0;
        const blocked = disabled || !!account.isFavorite;
        return (
          <AccountRow key={account.id}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text selectable style={{ color: colors.ink, fontSize: 16, fontWeight: '600' }}>
                {account.name}
                {account.isFavorite ? ' · Favorite' : ''}
              </Text>
              <Text
                selectable
                style={{
                  color: balance < 0 ? colors.negative : colors.muted,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {formatBalance(balance, code)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${account.name}, ${account.isFavorite ? 'favorite' : 'set as favorite'} for Quick add`}
              accessibilityState={{ selected: !!account.isFavorite, disabled: blocked }}
              disabled={blocked}
              onPress={() => onFavorite(account.id)}
              style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text
                accessible={false}
                style={{
                  color: account.isFavorite ? colors.accent : colors.muted,
                  fontSize: 28,
                }}
              >
                {account.isFavorite ? '★' : '☆'}
              </Text>
            </Pressable>
          </AccountRow>
        );
      })}
    </View>
  ));
}

export function AccountsSkeleton({ header }: { header: ReactNode }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading accounts" style={{ gap: 18 }}>
      <OverviewCard>
        <Skeleton width="55%" height={32} />
      </OverviewCard>
      {header}
      <View style={{ gap: 8 }}>
        <Skeleton width={140} height={20} />
        {[0, 1, 2].map((row) => (
          <AccountRow key={row}>
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton width="50%" height={18} />
              <Skeleton width="35%" />
            </View>
            <Skeleton width={28} height={28} borderRadius={14} />
          </AccountRow>
        ))}
      </View>
    </View>
  );
}

export function AccountsError({ header, retry }: { header: ReactNode; retry: () => void }) {
  return (
    <>
      {header}
      <Text selectable accessibilityRole="alert" style={{ color: colors.negative }}>
        Could not load accounts.
      </Text>
      <FormButton label="Retry accounts" variant="secondary" onPress={retry} />
    </>
  );
}

export function AddAccountSheet({
  form,
  onChange,
  pending,
  error,
  onSave,
  onClose,
}: {
  form: AccountForm;
  onChange: (form: AccountForm) => void;
  pending: boolean;
  error?: string;
  onSave: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  return (
    <AppSheet
      pending={pending}
      onDismiss={() => {
        if (!pending) onClose();
      }}
    >
      <ScrollView
        style={{ width, maxHeight: height * 0.82 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: theme.spacing.indent,
          paddingBottom: insets.bottom + theme.spacing.indent,
          gap: theme.spacing.lg,
        }}
      >
        <Text style={{ color: colors.ink, fontSize: theme.type.heading, fontWeight: '700' }}>
          Add account
        </Text>
        <FormInput
          accessibilityLabel="Account name"
          placeholder="Account name"
          placeholderTextColor={colors.muted}
          value={form.name}
          onChangeText={(name) => onChange({ ...form, name })}
          maxLength={100}
          editable={!pending}
        />
        <FormInput
          accessibilityLabel="Currency code"
          placeholder="Currency (e.g. BDT)"
          placeholderTextColor={colors.muted}
          value={form.currencyCode}
          onChangeText={(currencyCode) => onChange({ ...form, currencyCode })}
          autoCapitalize="characters"
          maxLength={3}
          editable={!pending}
        />
        <FormInput
          accessibilityLabel="Opening balance"
          placeholder="Opening balance"
          placeholderTextColor={colors.muted}
          value={form.openingBalance}
          onChangeText={(openingBalance) => onChange({ ...form, openingBalance })}
          keyboardType="numbers-and-punctuation"
          editable={!pending}
        />
        <Text style={{ color: colors.muted }}>
          Currency is fixed after creation. Opening balance may be negative.
        </Text>
        {error && (
          <Text selectable accessibilityRole="alert" style={{ color: colors.negative }}>
            {error}
          </Text>
        )}
        <FormButton label="Create account" loading={pending} onPress={onSave} />
        <FormButton label="Cancel" variant="secondary" disabled={pending} onPress={onClose} />
      </ScrollView>
    </AppSheet>
  );
}
