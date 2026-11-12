import type { ReactNode } from 'react';
import { Stack } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Skeleton } from '@/components/loading';
import { theme as t } from '@/theme';

const c = t.colors;

export function CategoriesLayout({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen
        options={{
          title: 'Categories',
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
        }}
      />
      {children}
    </View>
  );
}

function RetryButton({ label, retry }: { label: string; retry: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={retry}
      style={({ pressed }) => ({
        minHeight: t.controlHeight,
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: c.accent }}>{label}</Text>
    </Pressable>
  );
}

export function RefreshAlert({ retry }: { retry: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: t.spacing.md,
        paddingHorizontal: t.spacing.xl,
        paddingTop: t.spacing.md,
      }}
    >
      <Text accessibilityRole="alert" style={{ flex: 1, color: c.warning }}>
        Could not refresh categories.
      </Text>
      <RetryButton label="Retry" retry={retry} />
    </View>
  );
}

export function CategoriesError({ retry }: { retry: () => void }) {
  return (
    <View style={{ padding: t.spacing.xl, gap: t.spacing.sm }}>
      <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
        Could not load categories.
      </Text>
      <RetryButton label="Retry loading categories" retry={retry} />
    </View>
  );
}

function SkeletonGroup({ rows }: { rows: number }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 }}>
        <Skeleton width={80} height={20} />
        <Skeleton width={56} />
      </View>
      {Array.from({ length: rows }, (_, row) => (
        <View
          key={row}
          style={{
            minHeight: 48,
            justifyContent: 'center',
            paddingHorizontal: 16,
            borderRadius: t.radius.group,
            borderCurve: 'continuous',
            backgroundColor: c.root,
          }}
        >
          <Skeleton width={`${55 - row * 8}%`} height={16} />
        </View>
      ))}
    </View>
  );
}

export function CategoriesSkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading categories"
      style={{ padding: 20, gap: 18 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ flex: 1, color: c.text, fontSize: 21, fontWeight: '700' }}>
          Browse categories
        </Text>
        <Skeleton width={120} height={36} borderRadius={t.radius.control} />
      </View>
      <Skeleton width="80%" />
      <TextInput
        editable={false}
        accessible={false}
        placeholder="Search categories"
        placeholderTextColor={c.muted}
        style={{
          minHeight: 52,
          padding: 12,
          fontSize: 16,
          backgroundColor: c.surface,
          borderRadius: 12,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: c.line,
          opacity: 0.6,
        }}
      />
      <Skeleton width="60%" />
      <SkeletonGroup rows={4} />
      <SkeletonGroup rows={2} />
    </View>
  );
}
