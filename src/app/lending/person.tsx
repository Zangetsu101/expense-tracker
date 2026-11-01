import { useCallback, useState } from 'react';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { listPeople, listLendingEntries, listLendingTotals } from '@/lib/lending';
import { FormButton } from '@/components/form-controls';
import { formatEpochDay } from '@/lib/transaction-format';
import { theme } from '@/theme';

const c = theme.colors;
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const personId = Number(id);
  const [name, setName] = useState('Person');
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof listLendingEntries>>>([]);
  const [totals, setTotals] = useState<Awaited<ReturnType<typeof listLendingTotals>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([listPeople(), listLendingEntries(personId), listLendingTotals(personId)])
      .then(([people, history, balances]) => {
        if (!active) return;
        const person = people.find((p) => p.id === personId);
        if (!person) throw new Error('Person not found.');
        setName(person.name);
        setEntries(history);
        setTotals(balances);
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [personId]);
  useFocusEffect(load);
  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <FlatList
        style={{ backgroundColor: c.background }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}
        data={loading || error ? [] : entries}
        keyExtractor={(entry) => String(entry.id)}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            {loading ? (
              <ActivityIndicator color={c.accent} />
            ) : error ? (
              <>
                <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
                  {error}
                </Text>
                <FormButton label="Retry" onPress={load} />
              </>
            ) : (
              <>
                <FormButton
                  label="Add entry"
                  onPress={() => router.push({ pathname: '/lending/entry', params: { personId } })}
                />
                <Text style={{ color: c.muted }}>
                  Historical assignments may be incomplete. These balances are not a reconciliation.
                </Text>
                {totals.map((total) => (
                  <View
                    key={`${total.direction}-${total.currencyCode}`}
                    style={{ padding: 16, backgroundColor: c.surface, borderRadius: 16, gap: 8 }}
                  >
                    <Text style={{ color: c.muted }}>
                      {total.direction === 'LENT' ? 'They owe you' : 'You owe them'} · {total.currencyCode}
                    </Text>
                    <Text selectable style={{ color: c.text, fontSize: 24, fontVariant: ['tabular-nums'] }}>
                      {(total.outstandingMinor / 100).toFixed(2)}
                    </Text>
                    <Text selectable style={{ color: c.accent }}>
                      Overpaid credit: {(total.overpaidMinor / 100).toFixed(2)} {total.currencyCode}
                    </Text>
                  </View>
                ))}
                <Text style={{ color: c.text, fontSize: 20 }}>Full dated history</Text>
                {entries.length === 0 && <Text style={{ color: c.muted }}>No entries yet.</Text>}
              </>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ backgroundColor: c.surface, padding: 16, borderRadius: 16, gap: 8 }}>
            <Text selectable style={{ color: c.text }}>
              {item.kind.replaceAll('_', ' ')} · {(item.amountMinor / 100).toFixed(2)} {item.currencyCode}
            </Text>
            <Text selectable style={{ color: c.muted }}>
              {formatEpochDay(item.date)} · {item.accountName ?? 'No Account movement'}
            </Text>
            {!!item.note && (
              <Text selectable style={{ color: c.text }}>
                {item.note}
              </Text>
            )}
            <FormButton
              label="Edit entry"
              variant="secondary"
              onPress={() => router.push({ pathname: '/lending/entry', params: { id: item.id, personId } })}
            />
          </View>
        )}
      />
    </>
  );
}
