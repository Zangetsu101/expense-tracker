import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, LayoutAnimation, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryForm } from './category-form';
import { categoryPath, visibleTaxonomy, type VisibleCategory } from '../lib/category-taxonomy';
import type { ManagedCategory, CategoryType, CreateCategoryInput } from '../lib/categories';
import { theme as t } from '../theme';

type Kind = CategoryType;
type Category = ManagedCategory;
const c = { ...t.colors, bg: t.colors.background, ink: t.colors.text };

const grouping = { radius: t.radius.group, root: t.colors.root };
// Clip whole groups, not individual rows; keep sibling joins and row geometry intact.
const groupCorners = { borderRadius: grouping.radius, borderCurve: 'continuous', overflow: 'hidden' } as const;
const connector = { length: 14, radius: t.radius.elbow };
export function CategoryBrowser({ items, onSave }: { items: ManagedCategory[]; onSave: (input: CreateCategoryInput, editing?: ManagedCategory) => Promise<void> }) {
  const longPressSelected = useRef(false);
  const [focused, setFocused] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [reviewOpen, setReviewOpen] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => { if (mounted) setReducedMotion(enabled); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  const animateDisclosure = () => {
    if (reducedMotion) return;
    LayoutAnimation.configureNext({
      duration: 200,
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
  };
  const [adding, setAdding] = useState(false);
  const [addParent, setAddParent] = useState<number | null>(null);
  const [editing, setEditing] = useState<Category | undefined>();
  const [notice, setNotice] = useState('');
  const button = (label: string, action: () => void, primary = false, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={({ pressed }) => ({ minHeight: 48, minWidth: 48, justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.65 : 1 })}><View pointerEvents="none" style={{ minHeight: 36, paddingVertical: 6, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: t.radius.control, borderCurve: 'continuous', borderWidth: primary ? 0 : 1, borderColor: c.line, backgroundColor: primary ? c.accent : 'transparent' }}><Text style={{ color: primary ? c.bg : c.accent, fontWeight: '600' }}>{label}</Text></View></Pressable>;
  const search = <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, borderCurve: 'continuous', borderWidth: 1, borderColor: focused ? c.accent : c.line }}>
    <TextInput accessibilityLabel="Search categories" accessibilityHint="Matches include descendants and their ancestor path." placeholder="Search categories" placeholderTextColor={c.muted} selectionColor={c.accent} value={query} onChangeText={setQuery} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} returnKeyType="search" style={{ flex: 1, minHeight: 52, padding: 12, color: c.ink, fontSize: 16 }} />
    {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}><Text style={{ color: c.accent }}>Clear</Text></Pressable>}
  </View>;
  const path = (item: Category): string => categoryPath(items, item);
  const heading = (label: string, count: number) => <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 }}><Text style={{ color: c.accent, fontSize: 18, fontWeight: '700' }}>{label === 'EXPENSE' ? 'Expense' : 'Income'}</Text><Text style={{ color: c.muted }}>{count} {count === 1 ? 'root' : 'roots'}</Text></View>;
  const renderNode = (node: VisibleCategory, depth: number, continuations: boolean[] = [], last = true): React.ReactNode => {
    const { item, children: visibleChildren, reveal } = node;
    const hasChildren = items.some(child => child.parentId === item.id && child.type === item.type);
    const expanded = reveal || open.includes(item.id);
    const childCount = items.filter(child => child.parentId === item.id).length;
    const toggle = () => {
      if (hasChildren && !reveal) {
        animateDisclosure();
        setOpen(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id]);
      } else if (item.needsReview) setReviewOpen(current => current === item.id ? null : item.id);
    };
    const select = () => setSelected(item.id);
    const deselect = () => setSelected(null);
    return <View key={item.id} style={depth === 0 ? { ...groupCorners, backgroundColor: grouping.root } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${path(item)}, ${item.type}${item.needsReview ? ', needs review' : ''}${hasChildren ? `, ${expanded ? 'expanded' : 'collapsed'}` : ''}`} accessibilityState={{ selected: selected === item.id, ...(hasChildren ? { expanded } : {}) }} accessibilityHint={hasChildren ? 'Tap to expand or collapse. Long press to select, or use the Select category action.' : 'Long press to select, or use the Select category action.'} accessibilityActions={[
        { name: selected === item.id ? 'deselect' : 'select', label: selected === item.id ? 'Clear selection' : 'Select category' },
        ...(hasChildren && !reveal ? [{ name: expanded ? 'collapse' : 'expand', label: expanded ? 'Collapse category' : 'Expand category' }] : []),
        ...(item.needsReview ? [{ name: 'review', label: reviewOpen === item.id ? 'Hide review details' : 'Show review details' }] : []),
      ]} onAccessibilityAction={({ nativeEvent: { actionName } }) => {
        if (actionName === 'select') select();
        else if (actionName === 'deselect') deselect();
        else if (actionName === 'review') setReviewOpen(current => current === item.id ? null : item.id);
        else if (actionName === 'expand' || actionName === 'collapse') toggle();
      }} onPressIn={() => { longPressSelected.current = false; }} onLongPress={() => { longPressSelected.current = true; select(); }} onPress={() => { if (!longPressSelected.current) toggle(); }} style={({ pressed }) => ({ flex: 1, minHeight: 48, paddingVertical: 8, paddingLeft: 16 + depth * 24, paddingRight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: pressed || selected === item.id ? c.raised : 'transparent' })}>
        {Array.from({ length: depth }, (_, guide) => {
          const local = guide === depth - 1;
          return <View key={guide} pointerEvents="none" style={{ position: 'absolute', left: 22 + guide * 24, top: 0, bottom: 0, width: 16 }}>
            {/* End the upper stem at the arc tangent, not behind the rounded bend. */}
            {(local || continuations[guide]) && <View style={{ position: 'absolute', top: 0, bottom: local ? '50%' : 0, marginBottom: local ? connector.radius - 0.5 : 0, width: 1, backgroundColor: c.line }} />}
            {local && <View style={{ position: 'absolute', top: '50%', marginTop: -connector.radius - 0.5, height: connector.radius + 1, width: connector.length, borderLeftWidth: 1, borderBottomWidth: 1, borderBottomLeftRadius: connector.radius, borderColor: c.line }} />}
            {local && !last && <View style={{ position: 'absolute', top: '50%', marginTop: -connector.radius - 0.5, bottom: 0, width: 1, backgroundColor: c.line }} />}
          </View>;
        })}
        <Text accessible={false} style={{ width: 16, color: selected === item.id ? c.accent : c.muted, fontSize: 16 }}>{hasChildren ? expanded ? '▾' : '▸' : '•'}</Text>
        <Text numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1, color: c.ink, fontSize: 16, fontWeight: depth ? '400' : '700' }}>{item.name}</Text>{!!item.needsReview && <Text style={{ color: c.warning, fontSize: 12 }}>Review</Text>}
      </Pressable>
      <View pointerEvents={selected === item.id ? 'auto' : 'none'} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 48, alignItems: 'center', justifyContent: 'center' }}>
        {selected === item.id ? <Pressable accessibilityRole="button" accessibilityLabel={`Clear selection of ${item.name}`} onPress={deselect} style={({ pressed }) => ({ width: 48, flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: c.raised, opacity: pressed ? 0.6 : 1 })}><Text accessible={false} style={{ color: c.accent, fontSize: 24 }}>×</Text></Pressable> : hasChildren ? <Text accessibilityLabel={`${childCount} direct children total`} style={{ width: 48, textAlign: 'right', paddingRight: 16, color: c.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>{childCount}</Text> : null}
      </View>
      </View>
      {!!item.needsReview && (reviewOpen === item.id || hasChildren && expanded) && <View style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: c.line, backgroundColor: c.raised }}><Text style={{ color: c.warning, fontWeight: '700' }}>Imported Mixed Category · needs review</Text><Text selectable style={{ color: c.muted, lineHeight: 21 }}>MoneyLover used this category name for both positive and negative amounts. Its existing type is {item.type === 'EXPENSE' ? 'Expense' : 'Income'}. The imported classification is unchanged. This screen does not confirm or correct Category types.</Text></View>}
      {expanded && visibleChildren.length > 0 && <View>
        {visibleChildren.map((child, i) => renderNode(child, depth + 1, depth ? [...continuations, !last] : [], i === visibleChildren.length - 1))}
      </View>}
    </View>;
  };
  const group = (groupKind: Kind) => {
    const entries = visibleTaxonomy(items, groupKind, query);
    return <View key={groupKind} style={{ gap: 8 }}>{heading(groupKind, entries.length)}{entries.map(entry => renderNode(entry, 0))}</View>;
  };
  const selectedItem = items.find(item => item.id === selected);
  const add = (parentId: number | null) => { setEditing(undefined); setAddParent(parentId); setAdding(true); };
  const edit = () => { if (selectedItem) { setEditing(selectedItem); setAdding(true); } };
  const context = selectedItem ? path(selectedItem) : 'None · new categories go at the root';
  const toolbar = <View style={{ gap: 12 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      <Text style={{ flexGrow: 1, flexShrink: 1, flexBasis: 150, color: c.ink, fontSize: 21, fontWeight: '700' }}>Browse categories</Text>
      <View style={{ marginLeft: 'auto', flexDirection: 'row', gap: 8 }}>
        {button('Add', () => add(selectedItem?.id ?? null), true)}
        {button('Edit', edit, false, !selectedItem)}
      </View>
    </View>
    <Text accessibilityLiveRegion="polite" style={{ color: c.muted }}>Selected: {context}{selectedItem ? ' · Add creates a child; Edit renames.' : ' · Select a category to rename it.'}</Text>
  </View>;
  const hasResults = (['EXPENSE', 'INCOME'] as const).some(groupKind => visibleTaxonomy(items, groupKind, query).length);
  return <View style={{ flex: 1, backgroundColor: c.bg }}>
  <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: t.spacing.indent + insets.bottom, gap: 18 }}>
    {toolbar}
    <Text style={{ color: c.muted }}>Tap to expand. Long press to select for Add or Edit.</Text>
    {search}
    <Text accessibilityLiveRegion="polite" style={{ color: c.muted }}>{query.trim() ? `Results for "${query.trim()}" · matching branches expand automatically` : 'All categories · expansion stays local'}</Text>
    {group('EXPENSE')}{group('INCOME')}
    {!hasResults && <View style={{ gap: 12 }}><Text style={{ color: c.ink }}>{query.trim() ? 'No matching categories.' : 'No categories yet. Use Add to create a root category.'}</Text><Text style={{ color: c.muted }}>Search includes descendants and their ancestor paths.</Text>{button('Clear search', () => setQuery(''))}</View>}
    {!!notice && <Text accessibilityRole="alert" style={{ color: c.accent }}>{notice}</Text>}
  </ScrollView>
  {adding && <CategoryForm items={items} initialParentId={addParent} editing={editing} onClose={() => setAdding(false)} onSave={async input => {
    await onSave(input, editing);
    const parentId = input.parentId;
    if (parentId != null) setOpen(current => [...new Set([...current, parentId])]);
    setNotice(`${input.name} ${editing ? 'renamed' : 'added'}.`);
    setAdding(false);
  }} />}
  </View>;
}
