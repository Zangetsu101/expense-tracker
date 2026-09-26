import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { createCategory, listManagedCategories, markCategoryReviewed, type CategoryType, type ManagedCategory } from '@/lib/categories';

export default function CategoriesScreen() {
  const [categories, setCategories] = useState<ManagedCategory[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryType>('EXPENSE');
  const [parentId, setParentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try { setCategories(await listManagedCategories()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save() {
    setPending(true); setError(undefined);
    try { await createCategory({ name, type, parentId }); setName(''); setParentId(null); await load(); }
    catch (e) { setError(String(e)); }
    finally { setPending(false); }
  }
  async function review(id: number) {
    setPending(true); setError(undefined);
    try { await markCategoryReviewed(id); await load(); }
    catch (e) { setError(String(e)); }
    finally { setPending(false); }
  }

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
    <Text style={{ fontSize: 18, fontWeight: '600' }}>New category</Text>
    <TextInput accessibilityLabel="Category name" placeholder="Category name" value={name} onChangeText={setName} maxLength={100} style={{ padding: 12, borderBottomWidth: 1 }} />
    <Text>Type</Text>
    <View style={{ flexDirection: 'row', gap: 16 }}>
      {(['EXPENSE', 'INCOME'] as const).map((option) => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: type === option }} onPress={() => { setType(option); setParentId(null); }} style={{ padding: 12 }}><Text>{type === option ? '●' : '○'} {option === 'EXPENSE' ? 'Expense' : 'Income'}</Text></Pressable>)}
    </View>
    <Text>Parent (optional)</Text>
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: parentId === null }} onPress={() => setParentId(null)} style={{ padding: 8 }}><Text>{parentId === null ? '●' : '○'} None</Text></Pressable>
    {categories.filter((category) => category.type === type).map((category) => <Pressable key={category.id} accessibilityRole="radio" accessibilityState={{ checked: parentId === category.id }} onPress={() => setParentId(category.id)} style={{ padding: 8 }}><Text selectable>{parentId === category.id ? '●' : '○'} {category.name}</Text></Pressable>)}
    <Pressable accessibilityRole="button" disabled={pending || loading} onPress={() => void save()} style={{ padding: 16, backgroundColor: '#315fcb', borderRadius: 12 }}><Text style={{ color: 'white', fontWeight: '600' }}>{pending ? 'Saving…' : 'Create category'}</Text></Pressable>
    {error && <Text selectable accessibilityRole="alert" style={{ color: '#b00020' }}>{error}</Text>}
    {loading ? <ActivityIndicator /> : (['EXPENSE', 'INCOME'] as const).map((group) => <View key={group} style={{ gap: 8 }}>
      <Text style={{ fontSize: 18, fontWeight: '600' }}>{group === 'EXPENSE' ? 'Expense' : 'Income'}</Text>
      {categories.filter((category) => category.type === group).map((category) => <View key={category.id} style={{ padding: 16, backgroundColor: '#e8eaf0', borderRadius: 12, gap: 8 }}>
        <Text selectable style={{ fontWeight: '600' }}>{category.name}</Text>
        {category.parentName && <Text selectable>Parent: {category.parentName}</Text>}
        {!!category.needsReview && <><Text>Imported Mixed Category · needs review</Text><Pressable accessibilityRole="button" disabled={pending} onPress={() => void review(category.id)}><Text>Mark reviewed</Text></Pressable></>}
      </View>)}
      {!categories.some((category) => category.type === group) && <Text>No categories yet.</Text>}
    </View>)}
  </ScrollView>;
}
