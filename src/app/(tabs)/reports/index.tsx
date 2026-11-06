import { useCallback, useEffect, useRef, useState } from 'react';
import { FormButton, FormInput } from '@/components/form-controls';
import { AppSheet } from '@/components/app-sheet';
import { Stack, useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listManagedAccounts, type ManagedAccount } from '@/lib/accounts';
import { monthlyReport } from '@/lib/reports';
import { theme } from '@/theme';
import {
  changeReportYear,
  currencyReports,
  currentReportPeriod,
  parseReportYear,
  type CurrencyReportData,
} from '@/lib/report-presentation';

type MonthlyReport = Awaited<ReturnType<typeof monthlyReport>>;

const c = theme.colors;
const months = Array.from({ length: 12 }, (_, index) => ({
  label: new Date(2026, index, 1).toLocaleDateString('en-US', {
    month: 'long',
  }),
  short: new Date(2026, index, 1).toLocaleDateString('en-US', {
    month: 'short',
  }),
}));
const money = (amount: number, currency: string) =>
  `${currency} ${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: c.muted, fontSize: theme.type.caption, lineHeight: 18 }}>{children}</Text>
  );
}
function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Text
      accessibilityRole="header"
      style={{ color: c.text, fontSize: theme.type.heading, fontWeight: '700' }}
    >
      {children}
    </Text>
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
            <View
              key={label}
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: theme.spacing.sm,
                ...(label === 'Net'
                  ? {
                      borderTopWidth: 1,
                      borderColor: c.line,
                      paddingTop: theme.spacing.sm,
                    }
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
            </View>
          ))}
        </View>
        <Note>Net is income less expense, not your account balance.</Note>
      </View>
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

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const monthStrip = useRef<ScrollView>(null);
  const stripWidth = useRef(0);
  const [{ year, month }, setPeriod] = useState(currentReportPeriod);
  const [scope, setScope] = useState<number | undefined>();
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [report, setReport] = useState<MonthlyReport>();
  const loadedQuery = useRef<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [choosingScope, setChoosingScope] = useState(false);
  const [choosingYear, setChoosingYear] = useState(false);
  const [yearDraft, setYearDraft] = useState('');
  const [yearError, setYearError] = useState('');
  const { height, width } = useWindowDimensions();
  const account = accounts.find((item) => item.id === scope);
  const scopeLabel = account ? `${account.name} · ${account.currencyCode}` : 'All accounts';
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const query = `${year}-${month}-${scope ?? 'all'}`;
      const refreshing = loadedQuery.current === query;
      setLoading(!refreshing);
      setError(undefined);
      if (!refreshing) {
        loadedQuery.current = undefined;
        setReport(undefined);
      }
      Promise.all([listManagedAccounts(), monthlyReport(year, month + 1, scope)])
        .then(([nextAccounts, nextReport]) => {
          if (!active) return;
          setAccounts(nextAccounts);
          if (scope !== undefined && !nextAccounts.some((item) => item.id === scope)) {
            setScope(undefined);
            return;
          }
          loadedQuery.current = query;
          setReport(nextReport);
          setLoading(false);
        })
        .catch((reason) => {
          if (!active) return;
          setError(reason instanceof Error ? reason.message : 'Unable to load reports.');
          setLoading(false);
        });
      return () => {
        active = false;
      };
      // Retry intentionally invalidates the focused query after a failed read.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [year, month, scope, retry]),
  );
  const reports = report ? currencyReports(report, accounts, scope) : [];
  const monthLabel = `${months[month].label} ${year}`;
  const centerStrip = () =>
    monthStrip.current?.scrollTo({
      x: Math.max(0, month * 72 + 32 - stripWidth.current / 2),
      animated: false,
    });
  useEffect(centerStrip, [month, year]);
  const chooseYear = () => {
    setYearDraft(String(year));
    setYearError('');
    setChoosingYear(true);
  };
  const applyYear = () => {
    const value = parseReportYear(yearDraft);
    if (value === undefined) {
      setYearError('Enter a year from 1 to 9999.');
      return;
    }
    setPeriod((current) => ({ ...current, year: value }));
    setChoosingYear(false);
  };
  const selectScope = (value: number | undefined) => {
    setScope(value);
    setChoosingScope(false);
  };
  const scopeOptions: {
    value: number | undefined;
    label: string;
    detail: string;
  }[] = [
    {
      value: undefined,
      label: 'All accounts',
      detail: 'Same-currency accounts are grouped; currencies stay separate',
    },
    ...accounts.map((item) => ({
      value: item.id,
      label: `${item.name} · ${item.currencyCode}`,
      detail: `Report only ${item.name}; currency comes from this account`,
    })),
  ];
  const yearControl = (
    label: string,
    text: string,
    action: () => void,
    trigger = false,
    disabled = false,
  ) => (
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
      onPress={action}
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
        <View style={{ gap: theme.spacing.sm }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: theme.spacing.sm,
            }}
          >
            {yearControl(
              'Previous year',
              'Previous',
              () => setPeriod((current) => changeReportYear(current, -1)),
              false,
              year === 1,
            )}
            {yearControl(`Choose report year, ${year}`, String(year), chooseYear, true)}
            {yearControl(
              'Next year',
              'Next',
              () => setPeriod((current) => changeReportYear(current, 1)),
              false,
              year === 9999,
            )}
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
                onPress={() => setPeriod({ year, month: value })}
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
            {monthLabel}
          </Text>
          <Note>Year controls keep the month. Tap the year to jump farther.</Note>
          <Text style={{ color: c.muted }}>Account scope</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Choose account scope, ${scopeLabel}`}
            onPress={() => setChoosingScope(true)}
            style={({ pressed }) => ({
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
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Text style={{ color: c.text, flex: 1 }}>{scopeLabel}</Text>
            <Text style={{ color: c.accent }}>▾</Text>
          </Pressable>
          <Note>
            {!account
              ? 'All accounts. Same-currency accounts are grouped; each currency stays separate.'
              : `${account?.name} only. Currency is ${account?.currencyCode}, determined by this account.`}
          </Note>
        </View>
        {loading ? (
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Loading reports"
            style={{ gap: theme.spacing.md }}
          >
            <ActivityIndicator color={c.accent} />
            <Note>Loading reports…</Note>
          </View>
        ) : error ? (
          <View style={{ gap: theme.spacing.md }}>
            <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
              {error}
            </Text>
            <FormButton
              variant="secondary"
              label="Retry"
              onPress={() => setRetry((value) => value + 1)}
            />
          </View>
        ) : reports.length === 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Heading>No reportable activity</Heading>
            <Note>
              {accounts.length === 0
                ? 'Add an account and transactions to see reports.'
                : `No reportable income or expenses for ${monthLabel} in ${scopeLabel}.`}
            </Note>
          </View>
        ) : (
          reports.map((report) => <CurrencyReport key={report.currencyCode} report={report} />)
        )}
        <Note>
          Transfers and transactions marked Exclude report are omitted from income, expense and
          spending.
        </Note>
      </ScrollView>
      {choosingYear && (
        <AppSheet pending={false} onDismiss={() => setChoosingYear(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{
              width,
              maxHeight: height * 0.82,
              backgroundColor: c.surface,
            }}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                padding: theme.spacing.xl,
                paddingBottom: insets.bottom + theme.spacing.indent,
                gap: theme.spacing.lg,
              }}
            >
              <Heading>Choose report year</Heading>
              <Note>
                Keep {months[month].label} and {scopeLabel}.
              </Note>
              <Text style={{ color: c.text }}>Year</Text>
              <FormInput
                accessibilityLabel="Report year"
                value={yearDraft}
                onChangeText={(value) => {
                  setYearDraft(value);
                  setYearError('');
                }}
                keyboardType="number-pad"
                maxLength={4}
                returnKeyType="done"
                onSubmitEditing={applyYear}
                style={{
                  borderColor: yearError ? c.warning : c.line,
                }}
              />
              {!!yearError && (
                <Text accessibilityRole="alert" style={{ color: c.warning }}>
                  {yearError}
                </Text>
              )}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: theme.spacing.sm,
                }}
              >
                <FormButton
                  variant="secondary"
                  label="Cancel"
                  onPress={() => setChoosingYear(false)}
                />
                <FormButton variant="primary" label="Go to year" onPress={applyYear} />
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </AppSheet>
      )}
      {choosingScope && (
        <AppSheet pending={false} onDismiss={() => setChoosingScope(false)}>
          <View
            style={{
              width,
              maxHeight: height * 0.82,
              backgroundColor: c.surface,
            }}
          >
            <ScrollView
              contentContainerStyle={{
                padding: theme.spacing.xl,
                paddingBottom: insets.bottom + theme.spacing.indent,
                gap: theme.spacing.md,
              }}
            >
              <Heading>Account scope</Heading>
              <Note>
                Choose All accounts or one account. Selecting an account also selects its currency.
              </Note>
              {scopeOptions.map((option) => (
                <Pressable
                  key={option.value ?? 'all'}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: scope === option.value }}
                  onPress={() => selectScope(option.value)}
                  style={({ pressed }) => ({
                    minHeight: 56,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    padding: theme.spacing.sm,
                    borderBottomWidth: 1,
                    borderColor: c.line,
                    backgroundColor: scope === option.value ? c.raised : 'transparent',
                    opacity: pressed ? 0.65 : 1,
                  })}
                >
                  <View style={{ flex: 1, gap: theme.spacing.xs }}>
                    <Text
                      style={{
                        color: c.text,
                        fontWeight: scope === option.value ? '700' : '400',
                      }}
                    >
                      {option.label}
                    </Text>
                    <Note>{option.detail}</Note>
                  </View>
                  <Text style={{ color: c.accent }}>{scope === option.value ? '✓' : ''}</Text>
                </Pressable>
              ))}
              <FormButton
                variant="secondary"
                label="Cancel"
                onPress={() => setChoosingScope(false)}
              />
            </ScrollView>
          </View>
        </AppSheet>
      )}
    </View>
  );
}
