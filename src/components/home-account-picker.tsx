import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { AppSheet } from './app-sheet';
import type { Account } from '@/lib/database';
import { theme } from '@/theme';

const c = theme.colors;

export function HomeAccountPicker({
  accounts,
  selectedId,
  onSelect,
}: {
  accounts: Account[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { width, height } = useWindowDimensions();
  const selected = accounts.find((account) => account.id === selectedId);
  const options = [
    { id: null, name: 'All accounts', currencyCode: '', isFavorite: 0 },
    ...accounts,
  ].filter((account) =>
    `${account.name} ${account.currencyCode}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose account, ${selected?.name ?? 'All accounts'}`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setQuery('');
          setOpen(true);
        }}
        style={{
          backgroundColor: c.raised,
          borderRadius: theme.radius.control,
          minHeight: 52,
          padding: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Text numberOfLines={2} style={{ flex: 1, color: c.text, fontWeight: '600', fontSize: 17 }}>
          {selected?.name ?? 'All accounts'}
          {selected ? ` · ${selected.currencyCode}` : ''}
        </Text>
        <SymbolView
          name={{ ios: 'chevron.down', android: 'expand_more' }}
          size={24}
          tintColor={c.muted}
        />
      </Pressable>
      {open && (
        <AppSheet pending={false} onDismiss={() => setOpen(false)}>
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
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{ color: c.text, fontSize: 20, fontWeight: '700', flex: 1 }}
              >
                Choose account
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setOpen(false)}
                style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 }}
              >
                <Text style={{ color: c.accent }}>Done</Text>
              </Pressable>
            </View>
            <TextInput
              accessibilityLabel="Find an account"
              placeholder="Find an account"
              placeholderTextColor={c.muted}
              value={query}
              onChangeText={setQuery}
              style={{
                backgroundColor: c.background,
                color: c.text,
                borderRadius: 12,
                padding: 12,
              }}
            />
            <FlatList
              data={options}
              keyExtractor={(account) => String(account.id)}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}
              ListEmptyComponent={
                <Text style={{ color: c.muted, paddingVertical: 16 }}>No matching accounts</Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.id === selectedId }}
                  onPress={() => {
                    onSelect(item.id);
                    setOpen(false);
                  }}
                  style={{
                    paddingVertical: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: c.line,
                    flexDirection: 'row',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: c.text, fontSize: 16 }}>{item.name}</Text>
                    <Text style={{ color: c.muted }}>
                      {item.id === null
                        ? 'Every account · totals by currency'
                        : `${item.currencyCode}${item.isFavorite ? ' · Favorite' : ''}`}
                    </Text>
                  </View>
                  {item.id === selectedId && <Text style={{ color: c.accent }}>✓</Text>}
                </Pressable>
              )}
            />
          </View>
        </AppSheet>
      )}
    </>
  );
}
