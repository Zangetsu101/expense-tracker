import { type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { formatActivityDay } from '@/lib/transaction-format';
import { theme } from '@/theme';
import {
  markMatches,
  rowView,
  type ListRow,
  type RowIcon,
  type ListScope,
  type TotalPart,
} from './list.ts';

const colors = theme.colors;
const toneColor = { normal: colors.text, income: colors.accent, muted: colors.muted } as const;
type Entering = ComponentProps<typeof Animated.View>['entering'];

function Marked({
  text,
  query,
  style,
}: {
  text: string;
  query: string;
  style: ComponentProps<typeof Text>['style'];
}) {
  return (
    <Text numberOfLines={1} style={style}>
      {markMatches(text, query).map((part, index) =>
        part.match ? (
          <Text
            key={index}
            style={{ color: colors.text, backgroundColor: 'rgba(139,224,190,0.28)' }}
          >
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

function Icon({ icon }: { icon: RowIcon }) {
  if (icon.kind === 'transfer')
    return (
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          borderWidth: 1.5,
          borderColor: colors.line,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colors.muted, fontSize: 17 }}>⇄</Text>
      </View>
    );
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: colors.raised,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{icon.text}</Text>
    </View>
  );
}

export function TransactionRow({
  row,
  scope,
  query,
  disabled,
  entering,
  onPress,
}: {
  row: ListRow;
  scope: ListScope;
  query: string;
  disabled: boolean;
  entering?: Entering;
  onPress: () => void;
}) {
  const view = rowView(row, scope);
  return (
    <Animated.View entering={entering}>
      <Pressable
        disabled={disabled}
        accessibilityState={{ disabled }}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[view.title, view.detail, view.amount].filter(Boolean).join(', ')}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 68,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Icon icon={view.icon} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Marked
            text={view.title}
            query={query}
            style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}
          />
          {view.detail && (
            <Marked text={view.detail} query={query} style={{ color: colors.muted }} />
          )}
        </View>
        <Text
          style={{
            color: toneColor[view.tone],
            fontWeight: view.tone === 'muted' ? '600' : '700',
            fontVariant: ['tabular-nums'],
          }}
        >
          {view.amount}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function Totals({ totals }: { totals: TotalPart[] }) {
  return (
    <View
      style={{
        flexShrink: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        columnGap: 10,
      }}
    >
      {totals.map((part) => (
        <Text
          key={part.text}
          style={{ color: toneColor[part.tone], fontSize: 12, fontVariant: ['tabular-nums'] }}
        >
          {part.text}
        </Text>
      ))}
    </View>
  );
}

/** The header of a day. It has a background because it sticks to the top while the day scrolls. */
export function DayHeader({
  date,
  totals,
  now,
  entering,
}: {
  date: number;
  totals: TotalPart[];
  now: Date;
  entering?: Entering;
}) {
  return (
    <Animated.View
      entering={entering}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 8,
        paddingTop: 16,
        paddingBottom: 6,
        backgroundColor: colors.background,
      }}
    >
      <Text style={{ color: colors.muted, fontWeight: '700' }}>{formatActivityDay(date, now)}</Text>
      <Totals totals={totals} />
    </Animated.View>
  );
}

/** Marks where an older period starts, with its totals. */
export function PeriodDivider({ label, totals }: { label: string; totals: TotalPart[] }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 8,
        marginTop: 24,
        paddingTop: 12,
        borderTopWidth: 2,
        borderTopColor: colors.line,
      }}
    >
      <Text style={{ color: colors.text, fontWeight: '700' }}>{label}</Text>
      <Totals totals={totals} />
    </View>
  );
}

export function ListMessage({ text }: { text: string }) {
  return <Text style={{ color: colors.muted, paddingVertical: 16 }}>{text}</Text>;
}

function EndButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 18,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: colors.line,
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: colors.accent, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

/**
 * The end of the list or of the search results. While the next part loads, the
 * button becomes a spinner in its place. A failed load offers Retry.
 */
export function ListEnd({
  text,
  action,
  loading,
  failed,
  onAction,
}: {
  text: string;
  /** The label of the button, or `null` when there is nothing more to load. */
  action: string | null;
  loading: boolean;
  /** The text of the error after a failed load. */
  failed: string | null;
  onAction: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
      <Text style={{ color: colors.muted, textAlign: 'center' }}>{text}</Text>
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Loading"
          color={colors.accent}
          style={{ minHeight: 44 }}
        />
      ) : failed ? (
        <>
          <Text accessibilityRole="alert" style={{ color: colors.warning }}>
            {failed}
          </Text>
          <EndButton label="Retry" onPress={onAction} />
        </>
      ) : (
        action && <EndButton label={action} onPress={onAction} />
      )}
    </View>
  );
}

/** Shows when the Account in view has no Transactions at all. */
export function EmptyList({
  title,
  body,
  onAdd,
}: {
  title: string;
  body: string | null;
  onAdd: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingTop: 28, paddingHorizontal: 12 }}>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>
        {title}
      </Text>
      {body && (
        <Text style={{ color: colors.muted, textAlign: 'center', lineHeight: 20 }}>{body}</Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a transaction"
        onPress={onAdd}
        style={({ pressed }) => ({
          marginTop: 6,
          minHeight: 44,
          paddingHorizontal: 18,
          borderRadius: 22,
          backgroundColor: colors.accent,
          justifyContent: 'center',
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Text style={{ color: colors.background, fontWeight: '700' }}>Add a transaction</Text>
      </Pressable>
    </View>
  );
}

/** Filters the list in place. The icon at the end opens the Transactions screen. */
export function SearchField({
  value,
  placeholder,
  onChange,
  onOpenFilters,
}: {
  value: string;
  placeholder: string;
  onChange: (text: string) => void;
  onOpenFilters: () => void;
}) {
  return (
    <View
      style={{
        minHeight: 48,
        borderRadius: 24,
        backgroundColor: colors.surface,
        paddingLeft: 16,
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
      <TextInput
        accessibilityRole="search"
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChange}
        returnKeyType="search"
        autoCorrect={false}
        style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 15, paddingVertical: 12 }}
      />
      {value !== '' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChange('')}
          style={{ width: 40, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
        >
          <SymbolView
            name={{ ios: 'xmark.circle.fill', android: 'close' }}
            size={18}
            tintColor={colors.muted}
          />
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More filters"
        onPress={onOpenFilters}
        style={{ width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
      >
        <SymbolView
          name={{ ios: 'line.3.horizontal.decrease', android: 'filter_list' }}
          size={20}
          tintColor={colors.muted}
        />
      </Pressable>
    </View>
  );
}

/** A short message above the `+` button, with one action. */
export function Snackbar({ text, onShow }: { text: string; onShow: () => void }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 20,
        right: 20,
        bottom: 88,
        minHeight: 48,
        borderRadius: 12,
        paddingLeft: 16,
        backgroundColor: colors.raised,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <Text style={{ color: colors.text, flex: 1 }}>{text}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show"
        onPress={onShow}
        style={{ minHeight: 48, paddingHorizontal: 16, justifyContent: 'center' }}
      >
        <Text style={{ color: colors.accent, fontWeight: '700' }}>Show</Text>
      </Pressable>
    </View>
  );
}
