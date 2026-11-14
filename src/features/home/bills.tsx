import { Text, View } from 'react-native';
import { FormButton } from '@/components/form-controls';
import { formatBalance } from '@/lib/transaction-format';
import { theme } from '@/theme';
import type { DeckAccount } from './deck';
import { shortDay } from './period.ts';

export function Bills({
  accounts,
  onSettle,
}: {
  accounts: DeckAccount[];
  onSettle: (account: DeckAccount) => void;
}) {
  const cards = accounts.filter((a) => a.bill && a.bill.billMinor > 0);
  if (!cards.length) return null;
  return (
    <View style={{ gap: 12, padding: 20 }}>
      <Text
        accessibilityRole="header"
        style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}
      >
        Bills to settle
      </Text>
      {cards.map((a) => (
        <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: theme.colors.text }}>
              {a.name} · {formatBalance(a.bill!.billMinor, a.currencyCode)}
            </Text>
            {a.bill!.dueDate !== null && (
              <Text
                style={{
                  color: a.bill!.overdue ? theme.colors.warning : theme.colors.muted,
                  fontWeight: a.bill!.overdue ? '700' : '400',
                }}
              >
                {a.bill!.overdue ? 'Overdue' : 'Due'} {shortDay(a.bill!.dueDate!)}
              </Text>
            )}
          </View>
          <FormButton label={`Settle ${a.name}`} variant="secondary" onPress={() => onSettle(a)} />
        </View>
      ))}
    </View>
  );
}
