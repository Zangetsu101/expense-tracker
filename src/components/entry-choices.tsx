import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Account } from '@/lib/database';
import type { LendingTotal } from '@/lib/lending-totals';
import { pressableOpacity, theme } from '@/theme';
import { Shimmer } from './loading';

const c = theme.colors;
const accountChipGap = 8;
const accountStyles = StyleSheet.create({
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: accountChipGap },
  skeletonRows: { gap: accountChipGap },
  skeletonRow: { flexDirection: 'row', gap: accountChipGap },
  chip: {
    minHeight: 48,
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderCurve: 'continuous',
    justifyContent: 'center',
  },
});

function AccountChipLabel({
  name,
  currency,
  selected = false,
}: {
  name: string;
  currency: string;
  selected?: boolean;
}) {
  return (
    <Text style={{ fontSize: 14, color: selected ? c.onSelected : c.text }}>
      {name}
      {'  '}
      <Text style={{ fontSize: 11, color: selected ? c.onSelected : c.muted }}>{currency}</Text>
    </Text>
  );
}

export function AccountChoicesSkeleton() {
  return (
    <View
      style={accountStyles.skeletonRows}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[
        ['Checking', 'Cash'],
        ['Card', 'Savings'],
        ['Credit card', 'Travel'],
      ].map(([first, second]) => (
        <View key={first} style={accountStyles.skeletonRow}>
          {[first, second].map((name) => (
            <View
              key={name}
              style={[
                accountStyles.chip,
                { backgroundColor: c.raised, overflow: 'hidden', flexShrink: 1 },
              ]}
            >
              <View style={{ opacity: 0 }}>
                <AccountChipLabel name={name} currency="USD" />
              </View>
              <Shimmer />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function AccountChoices({
  accounts,
  selectedId,
  disabled,
  onSelect,
}: {
  accounts: Account[];
  selectedId?: number;
  disabled: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <View style={accountStyles.choices}>
      {accounts.map((account) => {
        const selected = account.id === selectedId;
        return (
          <Pressable
            key={account.id}
            accessibilityRole="button"
            accessibilityLabel={`${account.name}, ${account.currencyCode}${account.isFavorite ? ', favorite' : ''}`}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onSelect(account.id)}
            style={({ pressed }) => [
              accountStyles.chip,
              {
                backgroundColor: selected ? c.selected : '#1d2a30',
                opacity: pressableOpacity({ disabled, pressed }, { disabled: 0.45, pressed: 0.7 }),
              },
            ]}
          >
            <AccountChipLabel
              name={account.isFavorite ? `${account.name} ★` : account.name}
              currency={account.currencyCode}
              selected={selected}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export function personBalanceSummary(
  totals: LendingTotal[],
  personId: number,
  currencyCode: string,
) {
  const balances = totals.filter(
    (total) => total.personId === personId && total.currencyCode === currencyCode,
  );
  const amount = (minor: number) =>
    `${currencyCode} ${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const labels = balances.flatMap((total) => {
    if (total.overpaidMinor)
      return [
        `${total.direction === 'LENT' ? 'They overpaid' : 'You overpaid'} ${amount(total.overpaidMinor)}`,
      ];
    if (!total.outstandingMinor) return [];
    return [
      `${total.direction === 'LENT' ? 'owes you' : 'you owe'} ${amount(total.outstandingMinor)}`,
    ];
  });
  return labels.join(' · ') || `No recorded balance in ${currencyCode}`;
}

export function ChoiceChip({
  label,
  detail,
  selected,
  disabled,
  pending = false,
  onPress,
}: {
  label: string;
  detail?: string;
  selected?: boolean;
  disabled: boolean;
  pending?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, detail].filter(Boolean).join(', ')}
      accessibilityState={{ selected, disabled, busy: pending }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        opacity: pressableOpacity(
          { disabled, pressed: pressed || !!pending },
          { disabled: 0.45, pressed: pressed ? 0.65 : 0.7 },
        ),
        justifyContent: 'center',
        paddingHorizontal: 14,
        paddingVertical: 8,
        maxWidth: '100%',
        borderRadius: 14,
        backgroundColor: selected ? c.selected : c.surface,
      })}
    >
      {pending ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            style={{ color: selected ? c.onSelected : c.text, fontWeight: '600', flexShrink: 1 }}
          >
            {label}
          </Text>
          <ActivityIndicator size="small" color={selected ? c.onSelected : c.muted} />
        </View>
      ) : (
        <Text style={{ color: selected ? c.onSelected : c.text, fontWeight: '600' }}>{label}</Text>
      )}
      {!!detail && (
        <Text style={{ color: selected ? c.onSelected : c.muted, fontSize: 12 }}>{detail}</Text>
      )}
    </Pressable>
  );
}
