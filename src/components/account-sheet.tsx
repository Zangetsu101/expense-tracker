import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { AppSheet } from '@/components/app-sheet';
import { theme } from '@/theme';

const c = theme.colors;

export function AccountTitle({ name, onPress }: { name: string; onPress: () => void }) {
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

function AccountOption({
  name,
  detail,
  favorite,
  selected,
  onPress,
}: {
  name: string;
  detail?: string;
  favorite?: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
      onPress={onPress}
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
        {favorite ? ' ★' : ''}
      </Text>
      {detail !== undefined && (
        <Text style={{ color: c.muted, fontVariant: ['tabular-nums'] }}>{detail}</Text>
      )}
    </Pressable>
  );
}

function AccountSheetLayout({
  children,
  onAddAccount,
  onDismiss,
}: {
  children: ReactNode;
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
          {children}
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

export const AccountSheet = Object.assign(AccountSheetLayout, { Option: AccountOption });
