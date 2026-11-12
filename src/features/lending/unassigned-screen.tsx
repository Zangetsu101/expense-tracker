import { useState } from 'react';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Alert, FlatList, Text, View } from 'react-native';
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
  type Person,
  type UnassignedLendingTransaction,
} from '@/lib/lending';
import { FormButton } from '@/components/form-controls';
import { QueryBoundary } from '@/components/query-error-boundary';
import { formatEpochDay } from '@/lib/transaction-format';
import { theme } from '@/theme';
import { unassignedHistoryQuery } from './queries.ts';
import { EntryCardSkeleton, FallbackScroll, LendingAlert, LoadingGroup } from './view.tsx';

const c = theme.colors;
const listStyle = { padding: 20, paddingTop: 0, gap: 16, paddingBottom: 48 };

type Assignment = { row: UnassignedLendingTransaction; person: Person; confirmed: boolean };

function UnassignedList() {
  const { data, error, isFetching, refetch } = useSuspenseQuery(unassignedHistoryQuery());
  const { rows, people } = data;
  const [selected, setSelected] = useState<UnassignedLendingTransaction>();
  const assign = useMutation({
    mutationFn: ({ row, person, confirmed }: Assignment) =>
      assignLendingTransaction(row.transactionId, person.id, { confirmOverpayment: confirmed }),
    onSuccess: (result, assignment) => {
      if (result.status !== 'confirmation_required') return;
      Alert.alert(
        'Overpayment warning',
        result.warnings
          .map((w) => `${w.currencyCode}: overpaid credit ${(w.overpaidMinor / 100).toFixed(2)}`)
          .join('\n') + '\nAssign anyway? Credit stays separate from outstanding obligations.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Assign anyway',
            onPress: () => assign.mutate({ ...assignment, confirmed: true }),
          },
        ],
      );
    },
  });
  function start(row: UnassignedLendingTransaction, person: Person) {
    if (assign.isPending) return;
    setSelected(undefined);
    assign.mutate({ row, person, confirmed: false });
  }
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={listStyle}
        data={rows}
        keyExtractor={(r) => String(r.transactionId)}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            {!!error && !isFetching && (
              <LendingAlert
                message="Could not refresh unassigned entries."
                retry={() => void refetch()}
              />
            )}
            {!!assign.error && (
              <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
                {String(assign.error)}
              </Text>
            )}
            {rows.length === 0 && (
              <Text style={{ color: c.text }}>No unassigned historical lending entries.</Text>
            )}
            {people.length === 0 && (
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
              disabled={assign.isPending || isFetching || !people.length}
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
                        { text: 'Assign', onPress: () => start(row, person) },
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

function UnassignedSkeleton() {
  return (
    <FallbackScroll paddingTop={0}>
      <LoadingGroup label="Loading unassigned entries">
        <EntryCardSkeleton />
        <EntryCardSkeleton />
        <EntryCardSkeleton />
      </LoadingGroup>
    </FallbackScroll>
  );
}

function UnassignedError({ retry }: { retry: () => void }) {
  return (
    <FallbackScroll paddingTop={0}>
      <LendingAlert message="Could not load unassigned entries." retry={retry} />
    </FallbackScroll>
  );
}

export default function UnassignedScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: 'Unassigned history' }} />
      <Text style={{ color: c.muted, padding: 20 }}>
        Assign only when you know the person. This links the existing historical Transaction without
        creating another Account movement. Missing people are never guessed; balances remain
        incomplete until history is reconciled.
      </Text>
      <QueryBoundary
        pending={<UnassignedSkeleton />}
        error={(retry) => <UnassignedError retry={retry} />}
      >
        <UnassignedList />
      </QueryBoundary>
    </View>
  );
}
