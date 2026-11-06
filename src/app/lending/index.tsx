import { useCallback, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { createPerson, listPeople, listUnassignedLendingTransactions } from '@/lib/lending';
import { FormButton, FormInput } from '@/components/form-controls';
import { theme } from '@/theme';

const c = theme.colors;
export default function LendingScreen() {
  const [people, setPeople] = useState<Awaited<ReturnType<typeof listPeople>>>([]);
  const [unassigned, setUnassigned] = useState(0);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([listPeople(), listUnassignedLendingTransactions()])
      .then(([rows, history]) => {
        if (active) {
          setPeople(rows);
          setUnassigned(history.length);
        }
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
  }, []);
  useFocusEffect(load);
  async function add() {
    setPending(true);
    setError('');
    try {
      const person = await createPerson(name);
      setName('');
      router.push({ pathname: '/lending/person', params: { id: person.id } });
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Stack.Screen options={{ title: 'Lending & borrowing' }} />
      <FlatList
        style={{ flex: 1, backgroundColor: c.background }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}
        data={loading ? [] : people}
        keyExtractor={(person) => String(person.id)}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            <Text style={{ color: c.muted }}>
              People are shared across lending and borrowing. Balances stay separate by direction
              and currency.
            </Text>
            <FormButton label="Add money movement" onPress={() => router.push('/lending/entry')} />
            <FormInput
              accessibilityLabel="New person name"
              placeholder="Person’s name"
              value={name}
              onChangeText={setName}
              editable={!pending}
            />
            <FormButton
              label="Save person"
              variant="secondary"
              disabled={!name.trim()}
              loading={pending}
              onPress={() => void add()}
            />
            {loading && <ActivityIndicator color={c.accent} />}
            {!!error && (
              <>
                <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
                  {error}
                </Text>
                <FormButton label="Retry" onPress={load} />
              </>
            )}
            {!loading && !error && (
              <FormButton
                label={`Unassigned historical entries (${unassigned})`}
                variant="secondary"
                onPress={() => router.push('/lending/unassigned')}
              />
            )}
            {!loading && !error && people.length === 0 && (
              <Text style={{ color: c.muted }}>
                No saved people yet. Save a person to start recording lending or borrowing.
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <FormButton
            label={item.name}
            variant="secondary"
            onPress={() => router.push({ pathname: '/lending/person', params: { id: item.id } })}
          />
        )}
      />
    </>
  );
}
