import { useCallback, useRef, useState } from 'react';
import { Stack, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { CategoryBrowser } from '@/components/category-browser';
import {
  createCategory,
  listManagedCategories,
  updateCategory,
  type CreateCategoryInput,
  type ManagedCategory,
} from '@/lib/categories';
import { theme as t } from '@/theme';

export default function CategoriesScreen() {
  const [categories, setCategories] = useState<ManagedCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const items = await listManagedCategories();
      if (request === generation.current) {
        setCategories(items);
        setLoaded(true);
      }
    } catch (error) {
      if (request === generation.current)
        setError(error instanceof Error ? error.message : 'Could not load categories.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        generation.current++;
      };
    }, [load]),
  );

  const save = async (input: CreateCategoryInput, editing?: ManagedCategory) => {
    if (editing) await updateCategory(editing.id, input.name, input.iconKey);
    else await createCategory(input);
    // A committed write must never be reported as a failed save: retry only the read.
    void load();
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <Stack.Screen
        options={{
          title: 'Categories',
          headerStyle: { backgroundColor: t.colors.background },
          headerTintColor: t.colors.text,
        }}
      />
      {loading && !loaded && (
        <ActivityIndicator
          accessibilityLabel="Loading categories"
          color={t.colors.accent}
          style={{ padding: t.spacing.lg }}
        />
      )}
      {!!error && (
        <View style={{ padding: t.spacing.xl, gap: t.spacing.sm }}>
          <Text selectable accessibilityRole="alert" style={{ color: t.colors.warning }}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={{ minHeight: t.controlHeight, justifyContent: 'center' }}
          >
            <Text style={{ color: t.colors.accent }}>Retry loading categories</Text>
          </Pressable>
        </View>
      )}
      {loaded && <CategoryBrowser items={categories} onSave={save} />}
    </View>
  );
}
