import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import { confirmCandidate, listReviewCandidates, rejectCandidate, type ReviewCandidate } from '@/lib/review-queue';

export default function ReviewQueueScreen() {
  const [rows, setRows] = useState<ReviewCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try { setRows(await listReviewCandidates()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const resolve = async (id: number, action: 'confirm' | 'reject') => {
    setPending(id);
    try {
      if (action === 'confirm') await confirmCandidate(id);
      else await rejectCandidate(id);
      await load();
    } catch (e) { Alert.alert('Could not resolve candidate', String(e)); await load(); }
    finally { setPending(null); }
  };
  const ask = (id: number, action: 'confirm' | 'reject') => Alert.alert(
    action === 'confirm' ? 'Confirm transfer?' : 'Keep separate transactions?',
    action === 'confirm' ? 'Merge these two rows into one transfer.' : 'Reject this match without changing either transaction.',
    [{ text: 'Cancel', style: 'cancel' }, { text: action === 'confirm' ? 'Confirm' : 'Reject', onPress: () => void resolve(id, action) }],
  );
  return <FlatList contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 12 }}
    data={rows} keyExtractor={(row) => String(row.id)}
    ListHeaderComponent={loading ? <ActivityIndicator /> : error ? <Text selectable accessibilityRole="alert">{error}</Text> : rows.length === 0 ? <Text>No transfer candidates to review.</Text> : null}
    renderItem={({ item }) => <View style={{ padding: 16, borderRadius: 12, backgroundColor: '#e8eaf0', gap: 8 }}>
      <Text selectable style={{ fontWeight: '600' }}>{item.outgoingAccount} → {item.incomingAccount}</Text>
      <Text selectable>{(item.amountMinor / 100).toFixed(2)} {item.currencyCode} · {new Date(item.date * 86400000).toISOString().slice(0, 10)}</Text>
      <Text selectable>{item.confidenceNote}</Text>
      {item.outgoingNote && <Text selectable>Outgoing: {item.outgoingNote}</Text>}
      {item.incomingNote && <Text selectable>Incoming: {item.incomingNote}</Text>}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable accessibilityRole="button" disabled={pending !== null} onPress={() => ask(item.id, 'confirm')} style={{ padding: 12, backgroundColor: '#315fcb', borderRadius: 8 }}><Text style={{ color: 'white' }}>Confirm transfer</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={pending !== null} onPress={() => ask(item.id, 'reject')} style={{ padding: 12 }}><Text>Reject match</Text></Pressable>
      </View>
    </View>} />;
}
