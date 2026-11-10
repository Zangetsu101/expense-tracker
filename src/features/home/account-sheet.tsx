import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { AppSheet } from '@/components/app-sheet';
import { formatBalance } from '@/lib/transaction-format';
import { theme } from '@/theme';
import type { DeckCard } from './deck.ts';

const c = theme.colors;

/** The Home title. It names the Account in view and opens the Account list. */
export function HomeTitle({ name, onPress }: { name: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, choose account`}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, maxWidth: 260 }}
    >
      <Text
        numberOfLines={1}
        style={{ color: c.text, fontSize: 20, fontWeight: '700', flexShrink: 1 }}
      >
        {name}
      </Text>
      <SymbolView
        name={{ ios: 'chevron.down', android: 'expand_more' }}
        size={20}
        tintColor={c.text}
      />
    </Pressable>
  );
}

const rowStyle = {
  minHeight: 56,
  paddingVertical: 12,
  borderBottomWidth: 1,
  borderBottomColor: c.line,
  flexDirection: 'row',
  gap: 12,
  alignItems: 'center',
} as const;

/** All the cards of the deck in deck order. A tap moves the deck to that card. */
export function AccountSheet({
  cards,
  selectedId,
  onSelect,
  onAddAccount,
  onDismiss,
}: {
  cards: DeckCard[];
  selectedId: number | null;
  onSelect: (accountId: number | null) => void;
  onAddAccount: () => void;
  onDismiss: () => void;
}) {
  const { width, height } = useWindowDimensions();
  return (
    <AppSheet pending={false} onDismiss={onDismiss}>
      <View
        style={{
          backgroundColor: c.surface,
          padding: 20,
          gap: 12,
          width,
          height: height * 0.65,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text
            accessibilityRole="header"
            style={{ color: c.text, fontSize: 20, fontWeight: '700', flex: 1 }}
          >
            Go to account
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={onDismiss}
            style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 }}
          >
            <Text style={{ color: c.accent }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {cards.map((card) => {
            const name = card.account?.name ?? 'All accounts';
            const selected = card.accountId === selectedId;
            return (
              <Pressable
                key={String(card.accountId)}
                accessibilityRole="button"
                accessibilityLabel={name}
                accessibilityState={{ selected }}
                onPress={() => onSelect(card.accountId)}
                style={rowStyle}
              >
                <Text
                  style={{
                    color: selected ? c.accent : c.text,
                    fontSize: 16,
                    flex: 1,
                    fontWeight: selected ? '700' : '400',
                  }}
                >
                  {name}
                  {card.account?.isFavorite ? ' ★' : ''}
                </Text>
                {card.account && (
                  <Text style={{ color: c.muted, fontVariant: ['tabular-nums'] }}>
                    {formatBalance(card.account.balanceMinor, card.account.currencyCode)}
                  </Text>
                )}
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add account"
            onPress={onAddAccount}
            style={{ ...rowStyle, borderBottomWidth: 0 }}
          >
            <Text style={{ color: c.accent, fontSize: 16 }}>+ Add account</Text>
          </Pressable>
        </ScrollView>
      </View>
    </AppSheet>
  );
}
