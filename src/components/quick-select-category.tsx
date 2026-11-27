import { theme } from '@/theme';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type PressableProps,
} from 'react-native';
import { Skeleton } from './loading';
import { useClippedChips } from './use-clipped-chips';
import type { ManagedCategory } from '@/lib/categories';

const ink = '#f2f4f0';
const muted = '#aab9b7';
const panel = '#1d2a30';
const chipGap = 8;
const chipRadius = 12;
const chipRows = 3;
const styles = StyleSheet.create({
  section: { gap: 10 },
  selection: { color: ink },
  chips: { overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap', gap: chipGap },
});

function useChipLayout() {
  const { fontScale } = useWindowDimensions();
  const chipHeight = 20 + 20 * fontScale;
  return { chipHeight, maxHeight: chipRows * chipHeight + (chipRows - 1) * chipGap };
}

export function CategoryChoicesSkeleton() {
  const { chipHeight, maxHeight } = useChipLayout();
  return (
    <View style={styles.section}>
      <Text style={styles.selection}>Selected: None</Text>
      <CategorySearchInput disabled />
      <View style={[styles.chips, { height: maxHeight }]}>
        {(['26%', '31%', '27%', '38%', '22%', '25%', '23%', '32%', '28%'] as const).map(
          (width, index) => (
            <Skeleton key={index} width={width} height={chipHeight} borderRadius={chipRadius} />
          ),
        )}
      </View>
    </View>
  );
}

type Props = {
  categories: ManagedCategory[];
  orderedIds?: number[];
  selectedId?: number;
  onSelect: (id: number) => void;
  disabled?: boolean;
};

function CategorySearchInput({
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

function CategoryChip({
  label,
  selected,
  height,
  onLayout,
  accessibilityProps,
  onPress,
}: {
  label: string;
  selected: boolean;
  height: number;
  onLayout: (event: LayoutChangeEvent) => void;
  accessibilityProps: Pick<
    PressableProps,
    'disabled' | 'accessibilityElementsHidden' | 'importantForAccessibility'
  >;
  onPress: () => void;
}) {
  return (
    <View style={{ maxWidth: '100%' }} onLayout={onLayout}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected, disabled: accessibilityProps.disabled ?? false }}
        {...accessibilityProps}
        onPress={onPress}
        style={{
          paddingHorizontal: 13,
          paddingVertical: 10,
          borderRadius: chipRadius,
          maxWidth: '100%',
          height,
          backgroundColor: selected ? theme.colors.selected : '#29343a',
        }}
      >
        <Text numberOfLines={1} style={{ color: ink, lineHeight: 20 }}>
          {label}
        </Text>
      </Pressable>
    </View>
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
  const { chipHeight, maxHeight } = useChipLayout();
  const clipping = useClippedChips(maxHeight);
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
  return (
    <View style={styles.section}>
      <Text selectable accessibilityLiveRegion="polite" style={styles.selection}>
        Selected: {active ? path(active) : 'None'}
      </Text>
      <CategorySearchInput value={query} onChangeText={setQuery} disabled={disabled} />
      <View>
        <View style={[styles.chips, { maxHeight }]}>
          {matches.map((category) => (
            <CategoryChip
              key={category.id}
              label={path(category)}
              selected={activeId === category.id}
              height={chipHeight}
              onLayout={clipping.onLayout(category.id)}
              accessibilityProps={clipping.accessibilityProps(category.id, disabled)}
              onPress={() => onSelect(category.id)}
            />
          ))}
        </View>
        {matches.length === 0 && (
          <Text style={{ color: muted, padding: 12 }}>No matching categories</Text>
        )}
        {active &&
          (!matches.some((item) => item.id === active.id) ||
            clipping.clippedIds.has(active.id)) && (
            <Text style={{ color: muted, paddingTop: 4 }}>Search its name to find its chip.</Text>
          )}
      </View>
    </View>
  );
}
