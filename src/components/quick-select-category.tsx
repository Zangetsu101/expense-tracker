import { theme } from '@/theme';
import { useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { FadeOut, LinearTransition, ReduceMotion } from 'react-native-reanimated';
import type { ManagedCategory } from '@/lib/categories';

const ink = '#f2f4f0';
const muted = '#aab9b7';
const panel = '#1d2a30';
const layoutTransition = LinearTransition.duration(500).reduceMotion(ReduceMotion.System);

type Props = {
  categories: ManagedCategory[];
  orderedIds?: number[];
  selectedId?: number;
  onSelect: (id: number) => void;
  disabled?: boolean;
};

export function CategorySearchInput({
  value = '',
  onChangeText,
  disabled = false,
}: {
  value?: string;
  onChangeText?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <TextInput
      accessibilityLabel="Search categories"
      accessibilityState={{ disabled }}
      editable={!disabled}
      placeholder="Search categories or parent"
      placeholderTextColor={muted}
      value={value}
      onChangeText={onChangeText}
      style={{ backgroundColor: panel, color: ink, padding: 12, borderRadius: 12 }}
    />
  );
}

export function QuickSelectCategory({
  categories,
  orderedIds,
  selectedId,
  onSelect,
  disabled = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [clippedCategories, setClippedCategories] = useState<Set<number>>(() => new Set());
  const { fontScale } = useWindowDimensions();
  const chipHeight = 20 + 20 * fontScale;
  const maxHeight = chipHeight * 3 + 16;
  const byId = new Map(categories.map((category) => [category.id, category]));
  const path = (category: ManagedCategory) => {
    const names = [category.name];
    const seen = new Set([category.id]);
    let parent = category.parentId == null ? undefined : byId.get(category.parentId);
    while (parent && !seen.has(parent.id)) {
      names.unshift(parent.name);
      seen.add(parent.id);
      parent = parent.parentId == null ? undefined : byId.get(parent.parentId);
    }
    return names.join(' › ');
  };
  const activeId = selectedId;
  const active = activeId == null ? undefined : byId.get(activeId);
  const matches = (orderedIds ?? categories.map((category) => category.id))
    .map((id) => byId.get(id))
    .filter(
      (item): item is ManagedCategory =>
        !!item && path(item).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    );
  const chip = (category: ManagedCategory) => {
    const clipped = clippedCategories.has(category.id);
    return (
      <Animated.View
        key={category.id}
        layout={layoutTransition}
        exiting={FadeOut}
        style={{ maxWidth: '100%' }}
        onLayout={({ nativeEvent: { layout } }) => {
          const hidden = layout.y >= maxHeight;
          setClippedCategories((old) => {
            if (old.has(category.id) === hidden) return old;
            const next = new Set(old);
            if (hidden) next.add(category.id);
            else next.delete(category.id);
            return next;
          });
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={path(category)}
          accessibilityState={{ selected: activeId === category.id, disabled }}
          accessibilityElementsHidden={clipped}
          importantForAccessibility={clipped ? 'no-hide-descendants' : 'auto'}
          disabled={disabled || clipped}
          onPress={() => onSelect(category.id)}
          style={{
            paddingHorizontal: 13,
            paddingVertical: 10,
            borderRadius: 12,
            maxWidth: '100%',
            height: chipHeight,
            backgroundColor: activeId === category.id ? theme.colors.selected : '#29343a',
          }}
        >
          <Text numberOfLines={1} style={{ color: ink, lineHeight: 20 }}>
            {path(category)}
          </Text>
        </Pressable>
      </Animated.View>
    );
  };
  return (
    <View style={{ gap: 10 }}>
      <Text selectable accessibilityLiveRegion="polite" style={{ color: ink }}>
        Selected: {active ? path(active) : 'None'}
      </Text>
      <CategorySearchInput value={query} onChangeText={setQuery} disabled={disabled} />
      <View>
        <Animated.View
          layout={layoutTransition}
          style={{
            maxHeight,
            overflow: 'hidden',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {matches.map(chip)}
        </Animated.View>
        {matches.length === 0 && (
          <Text style={{ color: muted, padding: 12 }}>No matching categories</Text>
        )}
        {active &&
          (!matches.some((item) => item.id === active.id) || clippedCategories.has(active.id)) && (
            <Text style={{ color: muted, paddingTop: 4 }}>Search its name to find its chip.</Text>
          )}
      </View>
    </View>
  );
}
