import { useRef, useState } from 'react';
import { theme as t } from '../theme';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategorySheet } from './category-sheet';
import { categoryPath } from '../lib/category-taxonomy';
import type { ManagedCategory, CategoryType, CreateCategoryInput } from '../lib/categories';

type Kind = CategoryType;
type Props = { items: ManagedCategory[]; initialParentId?: number | null; editing?: ManagedCategory; onSave: (input: CreateCategoryInput) => Promise<void>; onClose: () => void };
const c = t.colors;

export function CategoryForm({ items, initialParentId = null, editing, onSave, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const parent = items.find(item => item.id === (editing ? editing.parentId : initialParentId));
  const [focused, setFocused] = useState(false);
  const [name, setName] = useState(editing?.name ?? '');
  const [topLevelKind, setTopLevelKind] = useState<Kind>('EXPENSE');
  const kind = editing?.type ?? parent?.type ?? topLevelKind;
  const parentId = parent?.id ?? null;
  const [error, setError] = useState('');
  const path = (item: ManagedCategory) => categoryPath(items, item);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const close = () => { if (!saving.current) onClose(); };
  const button = (label: string, action: () => void, primary = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={pending} accessibilityState={{ disabled: pending }} onPress={action} style={({ pressed }) => ({ flex: 1, minHeight: t.controlHeight, paddingHorizontal: t.spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.control, borderCurve: 'continuous', borderWidth: primary ? 0 : 1, borderColor: c.line, backgroundColor: primary ? c.accent : 'transparent', opacity: pending ? 0.5 : pressed ? 0.65 : 1 })}><Text style={{ color: primary ? c.background : c.muted, fontWeight: '600' }}>{label}</Text></Pressable>;
  const save = async () => {
    if (saving.current) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Enter a category name.'); return; }
    if (trimmed.length > 100) { setError('Use 100 characters or fewer.'); return; }
    if (items.some(item => item.id !== editing?.id && item.type === kind && item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) { setError('A category with this name and type already exists.'); return; }
    saving.current = true;
    setPending(true);
    setError('');
    try { await onSave({ name: trimmed, type: kind, parentId }); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save the category. Try again.'); }
    finally { saving.current = false; setPending(false); }
  };
  return <CategorySheet pending={pending} onDismiss={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width, maxHeight: height * 0.82, backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderCurve: 'continuous' }}>
      <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: t.spacing.xl, paddingBottom: insets.bottom + t.spacing.indent, gap: t.spacing.md }}>
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>{editing ? 'Rename category' : parent ? 'Add child category' : 'Add root category'}</Text>
        <Text selectable style={{ color: c.text }}>Parent: {parent ? path(parent) : 'None · top level'}</Text>
        {editing && <Text selectable style={{ color: c.muted }}>Path: {path(editing)} · rename only</Text>}
        <Text style={{ color: c.muted }}>{editing ? 'Parent and type cannot be changed here.' : 'Cancel to choose a different parent in the category tree.'}</Text>
        <TextInput accessibilityLabel={editing ? 'Category name' : 'New category name'} placeholder="Category name" placeholderTextColor={c.muted} value={name} editable={!pending} onChangeText={value => { setName(value); setError(''); }} maxLength={101} returnKeyType="done" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} selectionColor={c.accent} style={{ color: c.text, minHeight: t.controlHeight, borderWidth: 1, borderRadius: t.radius.control, borderCurve: 'continuous', borderColor: error ? c.warning : focused ? c.accent : c.line, padding: t.spacing.md }} />
        {editing || parent ? <Text style={{ color: c.muted }}>Type: {kind === 'EXPENSE' ? 'Expense' : 'Income'} · {editing ? 'read only' : 'inherited from parent'}</Text> : <View accessibilityRole="radiogroup" accessibilityLabel="Category type" style={{ flexDirection: 'row', borderWidth: 1, borderColor: c.line, borderRadius: t.radius.control, borderCurve: 'continuous', overflow: 'hidden' }}>{(['EXPENSE', 'INCOME'] as const).map((option, index) => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: kind === option }} disabled={pending} onPress={() => { setTopLevelKind(option); setError(''); }} style={({ pressed }) => ({ flex: 1, minHeight: t.controlHeight, alignItems: 'center', justifyContent: 'center', borderRightWidth: index === 0 ? 1 : 0, borderColor: c.line, backgroundColor: kind === option ? c.accent : c.surface, opacity: pending ? 0.5 : pressed ? 0.65 : 1 })}><Text style={{ color: kind === option ? c.background : c.muted, fontWeight: '600' }}>{option === 'EXPENSE' ? 'Expense' : 'Income'}</Text></Pressable>)}</View>}
        {!!error && <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>{error}</Text>}
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>{button('Cancel', close)}{button(pending ? 'Saving…' : 'Save', () => void save(), true)}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  </CategorySheet>;
}
