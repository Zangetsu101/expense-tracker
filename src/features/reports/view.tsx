import { useEffect, useRef, type ReactNode } from 'react';
import { Stack } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppSheet } from '@/components/app-sheet';
import { FormButton, FormInput } from '@/components/form-controls';
import { Skeleton } from '@/components/loading';
import type { ManagedAccount } from '@/lib/accounts';
import type { CurrencyReportData } from '@/lib/report-presentation';
import { theme } from '@/theme';

const c = theme.colors;
export const months = Array.from({ length: 12 }, (_, index) => ({
  label: new Date(2026, index, 1).toLocaleDateString('en-US', {
    month: 'long',
  }),
  short: new Date(2026, index, 1).toLocaleDateString('en-US', {
    month: 'short',
  }),
}));
const money = (amount: number, currency: string) =>
  `${currency} ${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function scopeLabel(account: ManagedAccount | undefined) {
  return account ? `${account.name} · ${account.currencyCode}` : 'All accounts';
}

function Note({ children }: { children: ReactNode }) {
  return (
    <Text style={{ color: c.muted, fontSize: theme.type.caption, lineHeight: 18 }}>{children}</Text>
  );
}
function Heading({ children }: { children: ReactNode }) {
  return (
    <Text
      accessibilityRole="header"
      style={{ color: c.text, fontSize: theme.type.heading, fontWeight: '700' }}
    >
      {children}
    </Text>
  );
}

export function ReportsLayout({
  period,
  sheet,
  children,
}: {
  period: ReactNode;
  sheet: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen
        options={{
          title: 'Reports',
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: theme.spacing.xl,
          paddingBottom: insets.bottom + theme.spacing.xl,
          gap: theme.spacing.indent,
        }}
      >
        <View style={{ gap: theme.spacing.sm }}>{period}</View>
        {children}
        <Note>
          Transfers and transactions marked Exclude report are omitted from income, expense and
          spending.
        </Note>
      </ScrollView>
      {sheet}
    </View>
  );
}

function YearControl({
  label,
  text,
  onPress,
  trigger = false,
  disabled = false,
}: {
  label: string;
  text: string;
  onPress: () => void;
  trigger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        trigger
          ? 'Opens the year chooser. The selected month is kept.'
          : 'Keeps the selected month.'
      }
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: trigger ? 96 : 80,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
      })}
    >
      <View
        pointerEvents="none"
        style={{
          width: 80,
          minHeight: 32,
          paddingHorizontal: theme.spacing.xs,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            color: c.accent,
            fontSize: trigger ? theme.type.heading : 14,
            fontWeight: trigger ? '700' : '500',
          }}
        >
          {text}
        </Text>
      </View>
    </Pressable>
  );
}

export function PeriodControls({
  year,
  month,
  onChangeYear,
  onChooseYear,
  onChooseMonth,
}: {
  year: number;
  month: number;
  onChangeYear: (delta: -1 | 1) => void;
  onChooseYear: () => void;
  onChooseMonth: (month: number) => void;
}) {
  const monthStrip = useRef<ScrollView>(null);
  const stripWidth = useRef(0);
  const centerStrip = () =>
    monthStrip.current?.scrollTo({
      x: Math.max(0, month * 72 + 32 - stripWidth.current / 2),
      animated: false,
    });
  useEffect(centerStrip, [month, year]);
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.sm,
        }}
      >
        <YearControl
          label="Previous year"
          text="Previous"
          onPress={() => onChangeYear(-1)}
          disabled={year === 1}
        />
        <YearControl
          label={`Choose report year, ${year}`}
          text={String(year)}
          onPress={onChooseYear}
          trigger
        />
        <YearControl
          label="Next year"
          text="Next"
          onPress={() => onChangeYear(1)}
          disabled={year === 9999}
        />
      </View>
      <ScrollView
        ref={monthStrip}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={(event) => {
          stripWidth.current = event.nativeEvent.layout.width;
          centerStrip();
        }}
        onContentSizeChange={centerStrip}
        contentContainerStyle={{ gap: theme.spacing.sm }}
      >
        {months.map((item, value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`${item.label} ${year}`}
            accessibilityState={{ selected: month === value }}
            onPress={() => onChooseMonth(value)}
            style={({ pressed }) => ({
              width: 64,
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              borderBottomWidth: 2,
              borderColor: month === value ? c.accent : c.line,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Text
              style={{
                color: month === value ? c.accent : c.text,
                fontWeight: month === value ? '700' : '400',
              }}
            >
              {item.short}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text accessibilityLiveRegion="polite" style={{ color: c.text, fontWeight: '600' }}>
        {months[month].label} {year}
      </Text>
      <Note>Year controls keep the month. Tap the year to jump farther.</Note>
    </>
  );
}

function ScopeRow({ children }: { children: ReactNode }) {
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text style={{ color: c.muted }}>Account scope</Text>
      {children}
    </View>
  );
}

const scopeButtonStyle = {
  minHeight: 48,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: theme.spacing.sm,
  paddingHorizontal: theme.spacing.md,
  borderWidth: 1,
  borderColor: c.line,
  borderRadius: theme.radius.control,
  borderCurve: 'continuous',
} as const;

export function ScopePicker({
  account,
  onOpen,
}: {
  account: ManagedAccount | undefined;
  onOpen: () => void;
}) {
  const label = scopeLabel(account);
  return (
    <ScopeRow>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose account scope, ${label}`}
        onPress={onOpen}
        style={({ pressed }) => ({ ...scopeButtonStyle, opacity: pressed ? 0.65 : 1 })}
      >
        <Text style={{ color: c.text, flex: 1 }}>{label}</Text>
        <Text style={{ color: c.accent }}>▾</Text>
      </Pressable>
      <Note>
        {!account
          ? 'All accounts. Same-currency accounts are grouped; each currency stays separate.'
          : `${account.name} only. Currency is ${account.currencyCode}, determined by this account.`}
      </Note>
    </ScopeRow>
  );
}

function ScopeRowSkeleton() {
  return (
    <ScopeRow>
      <View style={scopeButtonStyle}>
        <Skeleton width="40%" />
      </View>
      <Skeleton width="85%" height={12} />
    </ScopeRow>
  );
}

function SheetFrame({
  onDismiss,
  keyboard = false,
  children,
}: {
  onDismiss: () => void;
  keyboard?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const content = (
    <ScrollView
      keyboardShouldPersistTaps={keyboard ? 'handled' : undefined}
      contentContainerStyle={{
        padding: theme.spacing.xl,
        paddingBottom: insets.bottom + theme.spacing.indent,
        gap: keyboard ? theme.spacing.lg : theme.spacing.md,
      }}
    >
      {children}
    </ScrollView>
  );
  const style = { width, maxHeight: height * 0.82, backgroundColor: c.surface };
  return (
    <AppSheet pending={false} onDismiss={onDismiss}>
      {keyboard ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={style}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        <View style={style}>{content}</View>
      )}
    </AppSheet>
  );
}

export function ScopeSheet({
  accounts,
  selected,
  onSelect,
  onClose,
}: {
  accounts: ManagedAccount[];
  selected: number | undefined;
  onSelect: (value: number | undefined) => void;
  onClose: () => void;
}) {
  const options = [
    {
      value: undefined,
      label: 'All accounts',
      detail: 'Same-currency accounts are grouped; currencies stay separate',
    },
    ...accounts.map((item) => ({
      value: item.id as number | undefined,
      label: `${item.name} · ${item.currencyCode}`,
      detail: `Report only ${item.name}; currency comes from this account`,
    })),
  ];
  return (
    <SheetFrame onDismiss={onClose}>
      <Heading>Account scope</Heading>
      <Note>
        Choose All accounts or one account. Selecting an account also selects its currency.
      </Note>
      {options.map((option) => (
        <Pressable
          key={option.value ?? 'all'}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{ checked: selected === option.value }}
          onPress={() => onSelect(option.value)}
          style={({ pressed }) => ({
            minHeight: 56,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            padding: theme.spacing.sm,
            borderBottomWidth: 1,
            borderColor: c.line,
            backgroundColor: selected === option.value ? c.raised : 'transparent',
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <Text
              style={{
                color: c.text,
                fontWeight: selected === option.value ? '700' : '400',
              }}
            >
              {option.label}
            </Text>
            <Note>{option.detail}</Note>
          </View>
          <Text style={{ color: c.accent }}>{selected === option.value ? '✓' : ''}</Text>
        </Pressable>
      ))}
      <FormButton variant="secondary" label="Cancel" onPress={onClose} />
    </SheetFrame>
  );
}

export function YearSheet({
  month,
  draft,
  error,
  onChangeDraft,
  onApply,
  onClose,
}: {
  month: number;
  draft: string;
  error: string;
  onChangeDraft: (value: string) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <SheetFrame onDismiss={onClose} keyboard>
      <Heading>Choose report year</Heading>
      <Note>Keep {months[month].label} and the account scope.</Note>
      <Text style={{ color: c.text }}>Year</Text>
      <FormInput
        accessibilityLabel="Report year"
        value={draft}
        onChangeText={onChangeDraft}
        keyboardType="number-pad"
        maxLength={4}
        returnKeyType="done"
        onSubmitEditing={onApply}
        style={{ borderColor: error ? c.warning : c.line }}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: c.warning }}>
          {error}
        </Text>
      )}
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm }}
      >
        <FormButton variant="secondary" label="Cancel" onPress={onClose} />
        <FormButton variant="primary" label="Go to year" onPress={onApply} />
      </View>
    </SheetFrame>
  );
}

function CurrencyReport({ report }: { report: CurrencyReportData }) {
  const { currencyCode: currency, incomeMinor: income, expenseMinor: expense, categories } = report;
  const net = report.netMinor;
  return (
    <View style={{ gap: theme.spacing.indent }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Heading>{currency} report</Heading>
        <Note>{report.accountNames.join(' · ')}</Note>
      </View>
      <SummaryCard>
        <View style={{ gap: theme.spacing.sm }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: theme.spacing.sm,
            }}
          >
            <Note>Activity</Note>
            <Note>{currency}</Note>
          </View>
          {(
            [
              ['Income', income],
              ['Expense', expense === 0 ? 0 : -expense],
              ['Net', net],
            ] as const
          ).map(([label, amount]) => (
            <SummaryLine key={label} label={label}>
              <Text
                selectable
                accessibilityLabel={`${label}, ${money(amount, currency)}`}
                style={{
                  color: label === 'Net' ? c.accent : c.text,
                  fontVariant: ['tabular-nums'],
                  fontWeight: label === 'Net' ? '700' : '500',
                }}
              >
                {amount > 0 ? '+' : amount < 0 ? '−' : ''}
                {(Math.abs(amount) / 100).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Text>
            </SummaryLine>
          ))}
        </View>
      </SummaryCard>
      <View style={{ gap: theme.spacing.lg }}>
        <Heading>Spending by category</Heading>
        <Text
          selectable
          style={{
            color: c.accent,
            fontSize: theme.type.heading,
            fontWeight: '700',
            fontVariant: ['tabular-nums'],
          }}
        >
          {money(expense, currency)}
        </Text>
        <Note>
          {categories.length === 0
            ? 'No reportable expenses this month.'
            : 'Reportable expenses only. Shares are within this currency and account scope.'}
        </Note>
        {categories.map(({ categoryId, categoryName, amountMinor: amount, share }, rank) => {
          const name = categoryName ?? 'Uncategorized';
          return (
            <View key={categoryId ?? 'uncategorized'} style={{ gap: theme.spacing.sm }}>
              <Text style={{ color: c.text }}>
                {rank + 1}. {name}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  gap: theme.spacing.sm,
                }}
              >
                <Text selectable style={{ color: c.text, fontVariant: ['tabular-nums'] }}>
                  {money(amount, currency)}
                </Text>
                <Note>{share.toFixed(1)}% of spending</Note>
              </View>
              <View
                accessible
                accessibilityLabel={`${name}, ${share.toFixed(1)} percent of ${currency} spending`}
                style={{
                  height: 6,
                  backgroundColor: c.raised,
                  borderRadius: theme.radius.elbow,
                }}
              >
                <View
                  style={{
                    width: `${share}%`,
                    height: 6,
                    backgroundColor: c.accent,
                    borderRadius: theme.radius.elbow,
                  }}
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function SummaryCard({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        gap: theme.spacing.md,
        backgroundColor: c.surface,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.group,
        borderCurve: 'continuous',
      }}
    >
      <Heading>Monthly summary</Heading>
      {children}
      <Note>Net is income less expense, not your account balance.</Note>
    </View>
  );
}

function SummaryLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: theme.spacing.sm,
        ...(label === 'Net'
          ? { borderTopWidth: 1, borderColor: c.line, paddingTop: theme.spacing.sm }
          : {}),
      }}
    >
      <Text
        style={{
          color: label === 'Net' ? c.text : c.muted,
          fontWeight: label === 'Net' ? '700' : '400',
        }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

export function ReportView({
  reports,
  hasAccounts,
  periodLabel,
  scope,
  muted,
}: {
  reports: CurrencyReportData[];
  hasAccounts: boolean;
  periodLabel: string;
  scope: string;
  muted: boolean;
}) {
  return (
    <View
      accessibilityElementsHidden={muted}
      importantForAccessibility={muted ? 'no-hide-descendants' : 'auto'}
      style={{ gap: theme.spacing.indent, opacity: muted ? 0.4 : 1 }}
    >
      {reports.length === 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Heading>No reportable activity</Heading>
          <Note>
            {hasAccounts
              ? `No reportable income or expenses for ${periodLabel} in ${scope}.`
              : 'Add an account and transactions to see reports.'}
          </Note>
        </View>
      ) : (
        reports.map((report) => <CurrencyReport key={report.currencyCode} report={report} />)
      )}
    </View>
  );
}

export function ReportSkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading reports"
      style={{ gap: theme.spacing.indent }}
    >
      <View style={{ gap: theme.spacing.xs }}>
        <Skeleton width="40%" height={20} />
        <Skeleton width="55%" height={12} />
      </View>
      <SummaryCard>
        <View style={{ gap: theme.spacing.sm }}>
          {['Income', 'Expense', 'Net'].map((label) => (
            <SummaryLine key={label} label={label}>
              <Skeleton width={72} />
            </SummaryLine>
          ))}
        </View>
      </SummaryCard>
      <View style={{ gap: theme.spacing.lg }}>
        <Heading>Spending by category</Heading>
        <Skeleton width="35%" height={20} />
        {[0, 1].map((row) => (
          <View key={row} style={{ gap: theme.spacing.sm }}>
            <Skeleton width="45%" />
            <Skeleton width="100%" height={6} borderRadius={theme.radius.elbow} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function ScopeAndReportSkeleton() {
  return (
    <>
      <ScopeRowSkeleton />
      <ReportSkeleton />
    </>
  );
}

function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
        {message}
      </Text>
      <FormButton variant="secondary" label="Retry" onPress={retry} />
    </View>
  );
}

export function ReportsError({ retry }: { retry: () => void }) {
  return <LoadError message="Could not load accounts." retry={retry} />;
}

export function ReportError({ retry }: { retry: () => void }) {
  return <LoadError message="Could not load the report." retry={retry} />;
}

export function RefreshAlert({ message, retry }: { message: string; retry: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <Text accessibilityRole="alert" style={{ flex: 1, color: c.warning }}>
        {message}
      </Text>
      <FormButton variant="secondary" label="Retry" onPress={retry} />
    </View>
  );
}
