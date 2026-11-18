import { useState, type ReactNode } from 'react';
import NativeDatePicker from '@expo/ui/community/datetime-picker';
import { Stack } from 'expo-router';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppSheet } from '@/components/app-sheet';
import { FormButton } from '@/components/form-controls';
import { Skeleton } from '@/components/loading';
import type { ManagedAccount } from '@/lib/accounts';
import { dateFromEpochDay, epochDay } from '@/lib/database';
import { hasChildren, type CategoryShare, type CurrencyTotals } from '@/lib/report-presentation';
import { formatBalance } from '@/lib/transaction-format';
import { theme } from '@/theme';
import {
  dayParts,
  matchingShortcut,
  monthNames,
  shortcutRange,
  shortcuts,
  type RangeSettings,
  type ReportRange,
} from './range.ts';

export const c = theme.colors;

export function scopeLabel(account: ManagedAccount | undefined) {
  return account ? `${account.name} · ${account.currencyCode}` : 'All accounts';
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <Text style={{ color: c.muted, fontSize: theme.type.caption, lineHeight: 18 }}>{children}</Text>
  );
}
export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text
      accessibilityRole="header"
      style={{ color: c.text, fontSize: theme.type.heading, fontWeight: '700' }}
    >
      {children}
    </Text>
  );
}
export function Card({ children, gap = theme.spacing.md }: { children: ReactNode; gap?: number }) {
  return (
    <View
      style={{
        gap,
        backgroundColor: c.surface,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.group,
        borderCurve: 'continuous',
      }}
    >
      {children}
    </View>
  );
}

/** A scrolling page with the theme background and a header title. */
export function ReportPage({
  title,
  sheet,
  children,
}: {
  title: string;
  sheet?: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen
        options={{
          title,
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: theme.spacing.xl,
          paddingBottom: insets.bottom + theme.spacing.xl,
          gap: theme.spacing.lg,
        }}
      >
        {children}
      </ScrollView>
      {sheet}
    </View>
  );
}

function ArrowButton({
  label,
  text,
  disabled,
  onPress,
}: {
  label: string;
  text: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: theme.controlHeight,
        height: theme.controlHeight,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.3 : pressed ? 0.65 : 1,
      })}
    >
      <Text style={{ color: c.accent, fontSize: 26 }}>{text}</Text>
    </Pressable>
  );
}

/** The range name in the middle opens the range sheet. The arrows at the ends move the range. */
export function RangeHeader({
  name,
  dates,
  nextDisabled,
  onPrevious,
  onNext,
  onOpen,
}: {
  name: string;
  dates: string;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onOpen: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <ArrowButton label="Previous range" text="‹" disabled={false} onPress={onPrevious} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose range, ${name}`}
        accessibilityHint={dates}
        onPress={onOpen}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: theme.controlHeight,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: c.accent, fontSize: theme.type.heading, fontWeight: '700' }}
        >
          {name} ⌄
        </Text>
        <Note>{dates}</Note>
      </Pressable>
      <ArrowButton label="Next range" text="›" disabled={nextDisabled} onPress={onNext} />
    </View>
  );
}

export function RangeHeaderSkeleton() {
  return (
    <View style={{ minHeight: theme.controlHeight, alignItems: 'center', gap: theme.spacing.xs }}>
      <Skeleton width="45%" height={20} />
      <Skeleton width="35%" height={12} />
    </View>
  );
}

const longDay = (day: number) => {
  const { year, month, date } = dayParts(day);
  return `${date} ${monthNames[month].slice(0, 3)} ${year}`;
};

function DateField({
  label,
  day,
  open,
  onOpen,
}: {
  label: string;
  day: number;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${longDay(day)}`}
      accessibilityState={{ expanded: open }}
      onPress={onOpen}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 56,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.md,
        borderWidth: 1,
        borderColor: open ? c.accent : c.line,
        borderRadius: theme.radius.control,
        borderCurve: 'continuous',
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Note>{label}</Note>
      <Text style={{ color: c.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
        {longDay(day)}
      </Text>
    </Pressable>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 40,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.md,
        borderWidth: 1,
        borderColor: selected ? c.accent : c.line,
        borderRadius: 20,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Text style={{ color: selected ? c.accent : c.text, fontSize: theme.type.detail }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function StepButton({
  label,
  text,
  onPress,
}: {
  label: string;
  text: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: theme.controlHeight,
        height: theme.controlHeight,
        borderRadius: 24,
        backgroundColor: c.raised,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Text style={{ color: c.text, fontSize: 20 }}>{text}</Text>
    </Pressable>
  );
}

/**
 * The From and To dates are the main control. A shortcut fills both dates and closes the sheet.
 * The first month of the fiscal year is set here, as Home sets the start day of the month in its sheet.
 */
export function RangeSheet({
  range,
  today,
  settings,
  onChange,
  onFiscalStart,
  onClose,
}: {
  range: ReportRange;
  today: number;
  settings: RangeSettings;
  onChange: (range: ReportRange) => void;
  onFiscalStart: (month: number) => void;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const selected = matchingShortcut(range, today, settings);
  const last = range.end - 1;
  const pick = (date: Date) => {
    const day = epochDay(date);
    if (picking === 'from') onChange({ start: day, end: Math.max(day, last) + 1 });
    else onChange({ start: Math.min(range.start, day), end: day + 1 });
    setPicking(null);
  };
  return (
    <AppSheet pending={false} onDismiss={onClose}>
      <View
        style={{
          width,
          backgroundColor: c.surface,
          padding: theme.spacing.xl,
          paddingBottom: insets.bottom + theme.spacing.indent,
          gap: theme.spacing.lg,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Heading>Range</Heading>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={onClose}
            style={{ minHeight: theme.controlHeight, justifyContent: 'center' }}
          >
            <Text style={{ color: c.accent, fontSize: theme.type.body }}>Done</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <DateField
            label="From"
            day={range.start}
            open={picking === 'from'}
            onOpen={() => setPicking('from')}
          />
          <DateField
            label="To"
            day={last}
            open={picking === 'to'}
            onOpen={() => setPicking('to')}
          />
        </View>
        {picking && (
          <View style={{ gap: theme.spacing.sm }}>
            <NativeDatePicker
              value={dateFromEpochDay(picking === 'from' ? range.start : last)}
              mode="date"
              display={process.env.EXPO_OS === 'ios' ? 'inline' : 'default'}
              presentation={process.env.EXPO_OS === 'android' ? 'dialog' : 'inline'}
              accentColor={c.accent}
              {...(process.env.EXPO_OS === 'ios' ? { themeVariant: 'dark' as const } : {})}
              onValueChange={(_, date) => pick(date)}
              onDismiss={() => setPicking(null)}
            />
            {process.env.EXPO_OS !== 'android' && (
              <FormButton
                variant="secondary"
                label="Close date picker"
                onPress={() => setPicking(null)}
              />
            )}
          </View>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {shortcuts.map(({ key, label }) => (
            <Chip
              key={key}
              label={label}
              selected={selected === key}
              onPress={() => {
                onChange(shortcutRange(key, today, settings));
                onClose();
              }}
            />
          ))}
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            borderTopWidth: 1,
            borderColor: c.line,
            paddingTop: theme.spacing.md,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text }}>Fiscal year starts in</Text>
            <Note>The month that your year begins</Note>
          </View>
          <StepButton
            label="Earlier month"
            text="−"
            onPress={() => onFiscalStart((settings.fiscalStart + 11) % 12)}
          />
          <Text style={{ color: c.text, fontWeight: '700', minWidth: 84, textAlign: 'center' }}>
            {monthNames[settings.fiscalStart]}
          </Text>
          <StepButton
            label="Later month"
            text="+"
            onPress={() => onFiscalStart((settings.fiscalStart + 1) % 12)}
          />
        </View>
      </View>
    </AppSheet>
  );
}

const rowButton = {
  minHeight: theme.controlHeight,
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: theme.spacing.md,
  backgroundColor: c.surface,
  borderRadius: theme.radius.control,
  borderCurve: 'continuous',
} as const;

export function AccountRow({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Choose account scope, ${label}`}
      onPress={onOpen}
      style={({ pressed }) => ({ ...rowButton, opacity: pressed ? 0.65 : 1 })}
    >
      <Text style={{ color: c.accent, flex: 1 }}>{label} ⌄</Text>
    </Pressable>
  );
}

export function AccountRowSkeleton() {
  return (
    <View style={rowButton}>
      <Skeleton width="40%" />
    </View>
  );
}

/** All Currencies stay in view, so one tap changes the Currency. */
export function CurrencySwitch({
  currencies,
  selected,
  onSelect,
}: {
  currencies: string[];
  selected: string;
  onSelect: (currency: string) => void;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: 'row',
        backgroundColor: c.surface,
        borderRadius: theme.radius.control,
        padding: 3,
      }}
    >
      {currencies.map((code) => (
        <Pressable
          key={code}
          accessibilityRole="radio"
          accessibilityLabel={`Show ${code}`}
          accessibilityState={{ checked: code === selected }}
          onPress={() => onSelect(code)}
          style={{
            flex: 1,
            minHeight: 40,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 9,
            backgroundColor: code === selected ? c.selected : 'transparent',
          }}
        >
          <Text style={{ color: c.text, fontWeight: code === selected ? '700' : '400' }}>
            {code}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A sheet with a list of choices. */
function SheetFrame({ onDismiss, children }: { onDismiss: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  return (
    <AppSheet pending={false} onDismiss={onDismiss}>
      <View style={{ width, maxHeight: height * 0.82, backgroundColor: c.surface }}>
        <ScrollView
          contentContainerStyle={{
            padding: theme.spacing.xl,
            paddingBottom: insets.bottom + theme.spacing.indent,
            gap: theme.spacing.md,
          }}
        >
          {children}
        </ScrollView>
      </View>
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
    { value: undefined, label: 'All accounts' },
    ...accounts.map((item) => ({
      value: item.id as number | undefined,
      label: `${item.name} · ${item.currencyCode}`,
    })),
  ];
  return (
    <SheetFrame onDismiss={onClose}>
      <Heading>Account scope</Heading>
      <Note>One Account also sets the Currency. The Totals and the Trends follow the Account.</Note>
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
          <Text
            style={{
              flex: 1,
              color: c.text,
              fontWeight: selected === option.value ? '700' : '400',
            }}
          >
            {option.label}
          </Text>
          <Text style={{ color: c.accent }}>{selected === option.value ? '✓' : ''}</Text>
        </Pressable>
      ))}
      <FormButton variant="secondary" label="Cancel" onPress={onClose} />
    </SheetFrame>
  );
}

function SummaryLine({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: number;
  currency: string;
}) {
  const net = label === 'Net';
  const text = formatBalance(amount, currency);
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: theme.spacing.sm,
        ...(net ? { borderTopWidth: 1, borderColor: c.line, paddingTop: theme.spacing.sm } : {}),
      }}
    >
      <Text style={{ color: net ? c.text : c.muted, fontWeight: net ? '700' : '400' }}>
        {label}
      </Text>
      <Text
        selectable
        accessibilityLabel={`${label}, ${text}`}
        style={{
          color: label === 'Income' ? c.accent : c.text,
          fontVariant: ['tabular-nums'],
          fontWeight: net ? '700' : '500',
        }}
      >
        {text}
      </Text>
    </View>
  );
}

type Mark = 'up' | 'down' | null;
export type Marks = Map<number | null, Mark>;
const categoryName = (name: string | null) => name ?? 'Uncategorized';

function MarkText({ mark }: { mark: Mark }) {
  if (!mark) return null;
  return (
    <Text
      accessibilityLabel={mark === 'up' ? 'above usual' : 'below usual'}
      style={{ color: mark === 'up' ? c.warning : c.accent, fontSize: theme.type.caption }}
    >
      {mark === 'up' ? ' ▲' : ' ▼'}
    </Text>
  );
}

function ShareRow({
  row,
  currency,
  top,
  mark,
  toggle,
  small = false,
}: {
  row: CategoryShare;
  currency: string;
  top: number;
  mark: Mark;
  toggle?: { open: boolean };
  small?: boolean;
}) {
  const name = categoryName(row.name);
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm }}
      >
        <Text style={{ color: c.text, flex: 1, fontSize: small ? theme.type.detail : undefined }}>
          {name}
          {toggle && <Text style={{ color: c.accent }}>{toggle.open ? ' ▾' : ' ▸'}</Text>}
          <MarkText mark={mark} />
        </Text>
        <Text
          style={{
            color: c.text,
            fontVariant: ['tabular-nums'],
            fontSize: small ? theme.type.detail : undefined,
          }}
        >
          {formatBalance(row.amountMinor, currency)}
          {!toggle && row.id !== null && <Text style={{ color: c.accent }}> ›</Text>}
        </Text>
      </View>
      <View style={{ height: 6, backgroundColor: c.raised, borderRadius: theme.radius.elbow }}>
        <View
          style={{
            width: `${top === 0 ? 0 : (row.amountMinor / top) * 100}%`,
            height: 6,
            backgroundColor: c.accent,
            borderRadius: theme.radius.elbow,
          }}
        />
      </View>
    </View>
  );
}

/**
 * A tap on a parent Category opens it. A tap on a child Category, or on a Category with no
 * children, opens its Transactions. An open parent links to all of its Transactions.
 */
type TreeRow = { id: number | null; name: string | null; amountMinor: number };
type RowOptions = { toggle?: { open: boolean }; small: boolean };

export function CategoryTree<R extends TreeRow>({
  rows,
  currency,
  value,
  onOpenTransactions,
}: {
  rows: (R & { children: R[] })[];
  currency: string;
  /** Draws the inside of a row. Spending by category shows a bar; Movers shows the change. */
  value: (row: R, options: RowOptions) => ReactNode;
  onOpenTransactions: (categoryId: number) => void;
}) {
  const [open, setOpen] = useState<Set<number | null>>(new Set());
  const draw = value;
  const link = (row: R, child: boolean) => {
    const name = categoryName(row.name);
    if (row.id === null) return <View key="none">{draw(row, { small: child })}</View>;
    const id = row.id;
    return (
      <Pressable
        key={id}
        accessibilityRole="link"
        accessibilityLabel={`${name}, ${formatBalance(row.amountMinor, currency)}`}
        accessibilityHint="Shows its Transactions"
        onPress={() => onOpenTransactions(id)}
        style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
      >
        {draw(row, { small: child })}
      </Pressable>
    );
  };
  return (
    <View style={{ gap: theme.spacing.lg }}>
      {rows.map((row) => {
        if (!hasChildren(row)) return link(row, false);
        const isOpen = open.has(row.id);
        const id = row.id;
        return (
          <View key={row.id ?? 'none'} style={{ gap: theme.spacing.md }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${categoryName(row.name)}, ${formatBalance(row.amountMinor, currency)}`}
              accessibilityState={{ expanded: isOpen }}
              onPress={() =>
                setOpen((old) => {
                  const next = new Set(old);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.add(row.id);
                  return next;
                })
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
            >
              {draw(row, { toggle: { open: isOpen }, small: false })}
            </Pressable>
            {isOpen && (
              <View
                style={{
                  gap: theme.spacing.md,
                  marginLeft: theme.spacing.md,
                  paddingLeft: theme.spacing.md,
                  borderLeftWidth: 2,
                  borderColor: c.line,
                }}
              >
                {row.children.map((child) => link(child, true))}
                {id !== null && (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => onOpenTransactions(id)}
                    style={{ minHeight: 40, justifyContent: 'center' }}
                  >
                    <Text style={{ color: c.accent, fontSize: theme.type.detail }}>
                      All {categoryName(row.name)} Transactions ›
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

export function TotalsView({
  totals,
  marks,
  muted,
  emptyText,
  onOpenTransactions,
}: {
  totals: CurrencyTotals;
  marks: Marks | null;
  muted: boolean;
  emptyText: string;
  onOpenTransactions: (categoryId: number) => void;
}) {
  const currency = totals.currencyCode;
  return (
    <View
      accessibilityElementsHidden={muted}
      importantForAccessibility={muted ? 'no-hide-descendants' : 'auto'}
      style={{ gap: theme.spacing.lg, opacity: muted ? 0.4 : 1 }}
    >
      <Card>
        <Heading>Summary</Heading>
        <SummaryLine label="Income" amount={totals.incomeMinor} currency={currency} />
        <SummaryLine label="Expense" amount={totals.expenseMinor} currency={currency} />
        <SummaryLine label="Net" amount={totals.netMinor} currency={currency} />
      </Card>
      <Card gap={theme.spacing.lg}>
        <Heading>Spending by category</Heading>
        {totals.categories.length === 0 ? (
          <Note>{emptyText}</Note>
        ) : (
          <CategoryTree<CategoryShare>
            rows={totals.categories}
            currency={currency}
            value={(row, options) => (
              <ShareRow
                row={row}
                currency={currency}
                top={totals.categories[0]?.amountMinor ?? 0}
                mark={marks?.get(row.id) ?? null}
                {...options}
              />
            )}
            onOpenTransactions={onOpenTransactions}
          />
        )}
        {marks && marks.size > 0 && (
          <Note>▲ ▼ show a change of a fifth or more against your usual amount by this day.</Note>
        )}
      </Card>
    </View>
  );
}

export function TotalsSkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading reports"
      style={{ gap: theme.spacing.lg }}
    >
      <Card>
        <Heading>Summary</Heading>
        {['Income', 'Expense', 'Net'].map((label) => (
          <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.muted }}>{label}</Text>
            <Skeleton width={72} />
          </View>
        ))}
      </Card>
      <Card gap={theme.spacing.lg}>
        <Heading>Spending by category</Heading>
        {[0, 1].map((row) => (
          <View key={row} style={{ gap: theme.spacing.sm }}>
            <Skeleton width="45%" />
            <Skeleton width="100%" height={6} borderRadius={theme.radius.elbow} />
          </View>
        ))}
      </Card>
    </View>
  );
}

export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
        {message}
      </Text>
      <FormButton variant="secondary" label="Retry" onPress={retry} />
    </View>
  );
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
