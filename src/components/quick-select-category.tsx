import { theme } from '@/theme';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import type { ManagedCategory } from '@/lib/categories';

const ink = '#f2f4f0';
const muted = '#aab9b7';
const panel = '#1d2a30';
const chipTransition = LinearTransition.duration(220).reduceMotion(ReduceMotion.System);

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
  const [width, setWidth] = useState(0);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const [heights, setHeights] = useState<Record<number, number>>({});
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
  const rows: ManagedCategory[][] = [[], []];
  let used = 0;
  let row = 0;
  for (const category of matches) {
    const chipWidth = widths[category.id];
    if (!width || !chipWidth) continue;
    if (used && used + 8 + chipWidth > width) {
      row++;
      used = 0;
    }
    if (row > 1) break;
    rows[row].push(category);
    used += (used ? 8 : 0) + chipWidth;
  }
  const rowHeights = rows.map((items) =>
    Math.max(0, ...items.map((item) => heights[item.id] ?? 0)),
  );
  const chip = (category: ManagedCategory, stretch = false) => (
    <Pressable
      key={category.id}
      accessibilityRole="button"
      accessibilityLabel={path(category)}
      accessibilityState={{ selected: activeId === category.id, disabled }}
      disabled={disabled}
      onPress={() => onSelect(category.id)}
      style={{
        height: stretch ? '100%' : undefined,
        paddingHorizontal: 13,
        paddingVertical: 10,
        borderRadius: 12,
        maxWidth: width || undefined,
        backgroundColor: activeId === category.id ? theme.colors.selected : '#29343a',
      }}
    >
      <Text style={{ color: ink }}>{path(category)}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 10 }}>
      <Text selectable accessibilityLiveRegion="polite" style={{ color: ink }}>
        Selected: {active ? path(active) : 'None'}
      </Text>
      <CategorySearchInput value={query} onChangeText={setQuery} disabled={disabled} />
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            opacity: 0,
            flexDirection: 'row',
            alignItems: 'flex-start',
          }}
        >
          {categories.map((category) => (
            <View
              key={category.id}
              onLayout={(event) => {
                const measured = event.nativeEvent.layout.width;
                const height = event.nativeEvent.layout.height;
                setHeights((old) =>
                  old[category.id] === height ? old : { ...old, [category.id]: height },
                );
                setWidths((old) =>
                  old[category.id] === measured ? old : { ...old, [category.id]: measured },
                );
              }}
            >
              {chip(category)}
            </View>
          ))}
        </View>
        <View style={{ height: rowHeights[0] + 8 + rowHeights[1] }}>
          {rows.flatMap((items, rowIndex) => {
            let start = 0;
            return items.map((category) => {
              const x = start;
              start += widths[category.id] + 8;
              return (
                <Animated.View
                  key={category.id}
                  layout={chipTransition}
                  style={{
                    position: 'absolute',
                    start: x,
                    top: rowIndex === 0 ? 0 : rowHeights[0] + 8,
                    width: widths[category.id],
                    height: rowHeights[rowIndex],
                  }}
                >
                  {chip(category, true)}
                </Animated.View>
              );
            });
          })}
        </View>
        {matches.length === 0 && (
          <Text style={{ color: muted, padding: 12 }}>No matching categories</Text>
        )}
        {matches.length > rows[0].length + rows[1].length && (
          <Text style={{ color: muted, fontSize: 12, paddingTop: 4 }}>
            Refine search to see more
          </Text>
        )}
        {active && !rows.some((items) => items.some((item) => item.id === active.id)) && (
          <Text style={{ color: muted, paddingTop: 4 }}>Search its name to find its chip.</Text>
        )}
      </View>
    </View>
  );
}
