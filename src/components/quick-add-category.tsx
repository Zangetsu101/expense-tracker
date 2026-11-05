import { theme } from '@/theme';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ManagedCategory } from '@/lib/categories';

const ink = '#f2f4f0';
const muted = '#aab9b7';
const panel = '#1d2a30';

type Props = { categories: ManagedCategory[]; orderedIds: number[]; selectedId?: number; onSelect: (id: number) => void; disabled?: boolean };

export function QuickAddCategory({ categories, orderedIds, selectedId, onSelect, disabled = false }: Props) {
  const [query, setQuery] = useState('');
  const [width, setWidth] = useState(0);
  const [widths, setWidths] = useState<Record<number, number>>({});
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
  const matches = orderedIds.map((id) => byId.get(id)).filter((item): item is ManagedCategory => !!item && path(item).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const rows: ManagedCategory[][] = [[], []];
  let used = 0;
  let row = 0;
  for (const category of matches) {
    const chipWidth = widths[category.id];
    if (!width || !chipWidth) continue;
    if (used && used + 8 + chipWidth > width) { row++; used = 0; }
    if (row > 1) break;
    rows[row].push(category);
    used += (used ? 8 : 0) + chipWidth;
  }
  const chip = (category: ManagedCategory) => <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={path(category)} accessibilityState={{ selected: activeId === category.id, disabled }} disabled={disabled} onPress={() => onSelect(category.id)} style={{ paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12, maxWidth: width || undefined, backgroundColor: activeId === category.id ? theme.colors.selected : '#29343a' }}><Text style={{ color: ink }}>{path(category)}</Text></Pressable>;
  return <View style={{ gap: 10 }}>
    <Text selectable accessibilityLiveRegion="polite" style={{ color: ink }}>Selected: {active ? path(active) : 'None'}</Text>
    <TextInput accessibilityLabel="Search categories" editable={!disabled} placeholder="Search categories or parent" placeholderTextColor={muted} value={query} onChangeText={setQuery} style={{ backgroundColor: panel, color: ink, padding: 12, borderRadius: 12 }} />
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', opacity: 0, flexDirection: 'row' }}>{categories.map((category) => <View key={category.id} onLayout={(event) => {
        const measured = event.nativeEvent.layout.width;
        setWidths((old) => old[category.id] === measured ? old : { ...old, [category.id]: measured });
      }}>{chip(category)}</View>)}</View>
      <View style={{ gap: 8 }}>{rows.map((items, index) => <View key={index} style={{ flexDirection: 'row', gap: 8, overflow: 'hidden' }}>{items.map(chip)}</View>)}</View>
      {matches.length === 0 && <Text style={{ color: muted, padding: 12 }}>No matching categories</Text>}
      {matches.length > rows[0].length + rows[1].length && <Text style={{ color: muted, fontSize: 12, paddingTop: 4 }}>Refine search to see more</Text>}
      {active && !rows.some((items) => items.some((item) => item.id === active.id)) && <Text style={{ color: muted, paddingTop: 4 }}>Search its name to find its chip.</Text>}
    </View>
  </View>;
}
