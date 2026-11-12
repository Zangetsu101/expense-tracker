import { useRef, useState } from 'react';
import { theme as t } from '../theme';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FormButton, FormInput, JoinedChoice } from './form-controls';
import { AppSheet } from './app-sheet';
import { categoryPath } from '../lib/category-taxonomy';
import {
  maxCategoryEmojiLength,
  type ManagedCategory,
  type CategoryType,
  type CreateCategoryInput,
} from '../lib/categories';

type Kind = CategoryType;
type Props = {
  items: ManagedCategory[];
  initialParentId?: number | null;
  editing?: ManagedCategory;
  onSave: (input: CreateCategoryInput) => Promise<void>;
  onClose: () => void;
};
const c = t.colors;

export function CategoryForm({ items, initialParentId = null, editing, onSave, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const parent = items.find((item) => item.id === (editing ? editing.parentId : initialParentId));
  const [focused, setFocused] = useState(false);
  const [name, setName] = useState(editing?.name ?? '');
  const [emoji, setEmoji] = useState(editing?.emoji ?? '');
  const [topLevelKind, setTopLevelKind] = useState<Kind>('EXPENSE');
  const kind = editing?.type ?? parent?.type ?? topLevelKind;
  const parentId = parent?.id ?? null;
  const [error, setError] = useState('');
  const path = (item: ManagedCategory) => categoryPath(items, item);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const close = () => {
    if (!saving.current) onClose();
  };
  const save = async () => {
    if (saving.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a category name.');
      return;
    }
    if (trimmed.length > 100) {
      setError('Use 100 characters or fewer.');
      return;
    }
    if (
      items.some(
        (item) =>
          item.id !== editing?.id &&
          item.type === kind &&
          item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
      )
    ) {
      setError('A category with this name and type already exists.');
      return;
    }
    saving.current = true;
    setPending(true);
    setError('');
    try {
      await onSave({ name: trimmed, type: kind, parentId, emoji: emoji.trim() || null });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the category. Try again.');
    } finally {
      saving.current = false;
      setPending(false);
    }
  };
  return (
    <AppSheet pending={pending} onDismiss={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{
          width,
          maxHeight: height * 0.82,
          backgroundColor: c.surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderCurve: 'continuous',
        }}
      >
        <ScrollView
          style={{ flexGrow: 0 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{
            padding: t.spacing.xl,
            paddingBottom: insets.bottom + t.spacing.indent,
            gap: t.spacing.md,
          }}
        >
          <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>
            {editing ? 'Edit category' : parent ? 'Add child category' : 'Add root category'}
          </Text>
          <Text selectable style={{ color: c.text }}>
            Parent: {parent ? path(parent) : 'None · top level'}
          </Text>
          {editing && (
            <Text selectable style={{ color: c.muted }}>
              Path: {path(editing)}
            </Text>
          )}
          <Text style={{ color: c.muted }}>
            {editing
              ? 'Parent and type cannot be changed here.'
              : 'Cancel to choose a different parent in the category tree.'}
          </Text>
          <FormInput
            accessibilityLabel={editing ? 'Category name' : 'New category name'}
            placeholder="Category name"
            value={name}
            editable={!pending}
            onChangeText={(value) => {
              setName(value);
              setError('');
            }}
            maxLength={101}
            returnKeyType="done"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{ borderColor: error ? c.warning : focused ? c.accent : c.line }}
          />
          <FormInput
            accessibilityLabel="Emoji"
            placeholder={parent?.emoji ? `Emoji (${parent.emoji} from parent)` : 'Emoji'}
            value={emoji}
            editable={!pending}
            onChangeText={(value) => {
              setEmoji(value);
              setError('');
            }}
            maxLength={maxCategoryEmojiLength}
            returnKeyType="done"
          />
          {editing || parent ? (
            <Text style={{ color: c.muted }}>
              Type: {kind === 'EXPENSE' ? 'Expense' : 'Income'} ·{' '}
              {editing ? 'read only' : 'inherited from parent'}
            </Text>
          ) : (
            <JoinedChoice
              value={kind}
              options={[
                { value: 'EXPENSE', label: 'Expense' },
                { value: 'INCOME', label: 'Income' },
              ]}
              disabled={pending}
              onChange={(option) => {
                setTopLevelKind(option);
                setError('');
              }}
            />
          )}
          {!!error && (
            <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
              {error}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <FormButton
              label="Cancel"
              variant="secondary"
              disabled={pending}
              onPress={close}
              style={{ flex: 1 }}
            />
            <FormButton
              label={pending ? 'Saving…' : 'Save'}
              loading={pending}
              onPress={() => void save()}
              style={{ flex: 1 }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </AppSheet>
  );
}
