import { useCallback, useState } from 'react';
import { Stack, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Text, View } from 'react-native';
import {
  BottomSheet,
  Button,
  Column,
  Host,
  ScrollView as NativeScrollView,
  Text as NativeText,
} from '@expo/ui';
import {
  assignLendingTransaction,
  listPeople,
  listUnassignedLendingTransactions,
  type Person,
  type UnassignedLendingTransaction,
} from '@/lib/lending';
import { FormButton } from '@/components/form-controls';
import { formatEpochDay } from '@/lib/transaction-format';
import { theme } from '@/theme';
const c = theme.colors;
export default function UnassignedScreen() {
  const [rows, setRows] = useState<UnassignedLendingTransaction[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<UnassignedLendingTransaction>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([listUnassignedLendingTransactions(), listPeople()])
      .then(([r, p]) => {
        if (active) {
          setRows(r);
          setPeople(p);
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
  async function assign(row: UnassignedLendingTransaction, person: Person, confirmed = false) {
    if (pending) return;
    setPending(true);
    setError('');
    setSelected(undefined);
    try {
      const result = await assignLendingTransaction(row.transactionId, person.id, {
        confirmOverpayment: confirmed,
      });
      if (result.status === 'confirmation_required')
        Alert.alert(
          'Overpayment warning',
          result.warnings
            .map((w) => `${w.currencyCode}: overpaid credit ${(w.overpaidMinor / 100).toFixed(2)}`)
            .join('\n') + '\nAssign anyway? Credit stays separate from outstanding obligations.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Assign anyway', onPress: () => void assign(row, person, true) },
          ],
        );
      else setRows((current) => current.filter((r) => r.transactionId !== row.transactionId));
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: 'Unassigned history' }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}
        data={loading ? [] : rows}
        keyExtractor={(r) => String(r.transactionId)}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            <Text style={{ color: c.muted }}>
              Assign only when you know the person. This links the existing historical Transaction
              without creating another Account movement. Missing people are never guessed; balances
              remain incomplete until history is reconciled.
            </Text>
            {loading && <ActivityIndicator color={c.accent} />}
            {!!error && (
              <>
                <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
                  {error}
                </Text>
                <FormButton label="Retry" disabled={pending} onPress={load} />
              </>
            )}
            {!loading && !error && rows.length === 0 && (
              <Text style={{ color: c.text }}>No unassigned historical lending entries.</Text>
            )}
            {!loading && people.length === 0 && (
              <Text style={{ color: c.muted }}>
                Save a person in Lending & borrowing before assigning history.
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ backgroundColor: c.surface, padding: 16, borderRadius: 16, gap: 8 }}>
            <Text selectable style={{ color: c.text }}>
              {
                {
                  LEND: 'Lent',
                  BORROW: 'Borrowed',
                  RECEIVE_REPAYMENT: 'Repayment received',
                  REPAY: 'Repaid',
                }[item.kind]
              }{' '}
              · {(item.amountMinor / 100).toFixed(2)} {item.currencyCode}
            </Text>
            <Text selectable style={{ color: c.muted }}>
              {formatEpochDay(item.date)} · {item.accountName} · {item.categoryName}
            </Text>
            {!!item.note && (
              <Text selectable style={{ color: c.text }}>
                {item.note}
              </Text>
            )}
            <FormButton
              label="Assign person"
              variant="secondary"
              disabled={pending || !people.length}
              onPress={() => setSelected(item)}
            />
          </View>
        )}
      />
      <Host>
        <BottomSheet
          isPresented={!!selected}
          onDismiss={() => setSelected(undefined)}
          snapPoints={['half', 'full']}
        >
          <NativeScrollView>
            <Column>
              <NativeText>Choose the known person</NativeText>
              {people.map((person) => (
                <Button
                  key={person.id}
                  label={person.name}
                  onPress={() => {
                    const row = selected;
                    if (!row) return;
                    Alert.alert(
                      'Assign historical entry?',
                      `${(row.amountMinor / 100).toFixed(2)} ${row.currencyCode} on ${formatEpochDay(row.date)} → ${person.name}. No additional Account movement will be created.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Assign', onPress: () => void assign(row, person) },
                      ],
                    );
                  }}
                />
              ))}
            </Column>
          </NativeScrollView>
        </BottomSheet>
      </Host>
    </View>
  );
}
