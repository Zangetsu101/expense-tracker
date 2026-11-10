import { useSuspenseQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { FlatList, Text, View } from 'react-native';
import { FormButton } from '@/components/form-controls';
import { Skeleton } from '@/components/loading';
import { formatEpochDay } from '@/lib/transaction-format';
import { theme } from '@/theme';
import { personLedgerQuery } from './queries.ts';
import { ScopeBoundary } from '@/components/query-error-boundary';
import {
  ButtonSkeleton,
  EntryCardSkeleton,
  FallbackScroll,
  LendingAlert,
  LoadingGroup,
} from './view.tsx';

const c = theme.colors;

function PersonLedger({ personId }: { personId: number }) {
  const { data, error, isFetching, refetch } = useSuspenseQuery(personLedgerQuery(personId));
  const { person, entries, totals } = data;
  return (
    <>
      <Stack.Screen options={{ title: person.name }} />
      <FlatList
        style={{ backgroundColor: c.background }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}
        data={entries}
        keyExtractor={(entry) => String(entry.id)}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            {!!error && !isFetching && (
              <LendingAlert message="Could not refresh this person." retry={() => void refetch()} />
            )}
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
                  {total.direction === 'LENT' ? 'They owe you' : 'You owe them'} ·{' '}
                  {total.currencyCode}
                </Text>
                <Text
                  selectable
                  style={{ color: c.text, fontSize: 24, fontVariant: ['tabular-nums'] }}
                >
                  {(total.outstandingMinor / 100).toFixed(2)}
                </Text>
                <Text selectable style={{ color: c.accent }}>
                  Overpaid credit: {(total.overpaidMinor / 100).toFixed(2)} {total.currencyCode}
                </Text>
              </View>
            ))}
            <Text style={{ color: c.text, fontSize: 20 }}>Full dated history</Text>
            {entries.length === 0 && <Text style={{ color: c.muted }}>No entries yet.</Text>}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ backgroundColor: c.surface, padding: 16, borderRadius: 16, gap: 8 }}>
            <Text selectable style={{ color: c.text }}>
              {item.kind.replaceAll('_', ' ')} · {(item.amountMinor / 100).toFixed(2)}{' '}
              {item.currencyCode}
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
              onPress={() =>
                router.push({ pathname: '/lending/entry', params: { id: item.id, personId } })
              }
            />
          </View>
        )}
      />
    </>
  );
}

function PersonSkeleton() {
  return (
    <FallbackScroll>
      <Stack.Screen options={{ title: 'Person' }} />
      <LoadingGroup label="Loading person">
        <ButtonSkeleton />
        <Skeleton width="85%" />
        <View style={{ padding: 16, backgroundColor: c.surface, borderRadius: 16, gap: 10 }}>
          <Skeleton width="40%" />
          <Skeleton width="30%" height={28} />
          <Skeleton width="55%" />
        </View>
        <Text style={{ color: c.text, fontSize: 20 }}>Full dated history</Text>
        <EntryCardSkeleton />
        <EntryCardSkeleton />
      </LoadingGroup>
    </FallbackScroll>
  );
}

function PersonError({ retry }: { retry: () => void }) {
  return (
    <FallbackScroll>
      <Stack.Screen options={{ title: 'Person' }} />
      <LendingAlert message="Could not load this person." retry={retry} />
    </FallbackScroll>
  );
}

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const personId = Number(id);
  return (
    <ScopeBoundary
      scope={String(personId)}
      pending={<PersonSkeleton />}
      error={(retry) => <PersonError retry={retry} />}
    >
      <PersonLedger personId={personId} />
    </ScopeBoundary>
  );
}
