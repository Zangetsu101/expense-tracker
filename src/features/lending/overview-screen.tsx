import { useSuspenseQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { QueryBoundary } from '@/components/query-error-boundary';
import { Skeleton } from '@/components/loading';
import type { PersonWithTotals } from '@/lib/lending';
import type { LendingTotal } from '@/lib/lending-totals';
import { countLabel, formatActivityDay, formatBalance } from '@/lib/transaction-format';
import { lendingOverviewQuery } from './queries.ts';
import {
  AddEntryButton,
  BalanceAmounts,
  EmptyLedger,
  Heading,
  LedgerRow,
  LendingAlert,
  LendingBoundary,
  LendingScroll,
  MoneyText,
  Muted,
  colors,
  directionColor,
  divider,
  panel,
  personRoute,
  spacedRow,
} from './view.tsx';

function OpenTotals({ totals, compact = false }: { totals: LendingTotal[]; compact?: boolean }) {
  return (
    <View style={spacedRow}>
      {(['LENT', 'BORROWED'] as const).map((direction) => {
        const amounts = new Map<string, number>();
        for (const total of totals) {
          if (total.direction !== direction || !total.outstandingMinor) continue;
          amounts.set(
            total.currencyCode,
            (amounts.get(total.currencyCode) ?? 0) + total.outstandingMinor,
          );
        }
        return (
          <View
            key={direction}
            style={{
              flex: 1,
              gap: 2,
              alignItems: direction === 'LENT' ? 'flex-start' : 'flex-end',
            }}
          >
            <Text style={{ color: colors.muted, fontSize: compact ? 12 : 14 }}>
              {direction === 'LENT' ? 'Owed to you' : 'You owe'}
            </Text>
            {amounts.size ? (
              [...amounts]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([currency, amount], index) => (
                  <MoneyText
                    key={currency}
                    size={amountSize(compact, index)}
                    color={directionColor(direction)}
                  >
                    {formatBalance(amount, currency)}
                  </MoneyText>
                ))
            ) : (
              <MoneyText color={directionColor(direction)}>0</MoneyText>
            )}
          </View>
        );
      })}
    </View>
  );
}

function amountSize(compact: boolean, index: number) {
  if (compact) return 18;
  return index === 0 ? 22 : 14;
}

function largestOpenAmount(totals: LendingTotal[]) {
  return totals.reduce((largest, total) => Math.max(largest, total.outstandingMinor), 0);
}

function PersonRow({ person, settled = false }: { person: PersonWithTotals; settled?: boolean }) {
  const credit = person.totals
    .filter((total) => total.overpaidMinor)
    .map((total) => formatBalance(total.overpaidMinor, total.currencyCode));
  let detail: string;
  if (!settled)
    detail = [
      person.totals.some((t) => t.outstandingMinor && t.direction === 'LENT') && 'Owes you',
      person.totals.some((t) => t.outstandingMinor && t.direction === 'BORROWED') && 'You owe',
      person.lastDate !== undefined && formatActivityDay(person.lastDate),
    ]
      .filter(Boolean)
      .join(' · ');
  else if (credit.length) detail = `Overpaid credit ${credit.join(' · ')}`;
  else detail = 'Settled';
  return (
    <LedgerRow
      title={person.name}
      detail={detail}
      icon={Array.from(person.name)[0]?.toLocaleUpperCase() ?? '?'}
      settled={settled}
      amounts={settled ? <Muted>›</Muted> : <BalanceAmounts totals={person.totals} />}
      onPress={() => router.push(personRoute(person.id, person.name))}
    />
  );
}

function LendingOverview() {
  const { data: people, error, isFetching, refetch } = useSuspenseQuery(lendingOverviewQuery());
  const open = people
    .filter((person) => largestOpenAmount(person.totals))
    .sort((a, b) => largestOpenAmount(b.totals) - largestOpenAmount(a.totals));
  const settled = people.filter((person) => !largestOpenAmount(person.totals));
  const empty = !people.length;
  return (
    <>
      <LendingScroll>
        {!!error && !isFetching && (
          <LendingAlert refresh message="Could not refresh lending" retry={() => void refetch()} />
        )}
        {empty ? (
          <EmptyLedger
            title="No lending or borrowing yet"
            hint="Tap + when you lend money to a person or borrow money from a person."
          />
        ) : (
          <>
            <View style={panel}>
              <OpenTotals totals={people.flatMap((person) => person.totals)} />
              <View style={divider} />
              <Muted>{countLabel(open.length, 'person', 'people')} with open balances</Muted>
            </View>
            <View style={{ marginTop: 4 }}>
              <Heading>People</Heading>
              {open.map((person) => (
                <PersonRow key={person.id} person={person} />
              ))}
              {!!settled.length && (
                <>
                  <Text style={{ color: colors.muted, fontWeight: '700', marginTop: 16 }}>
                    Settled
                  </Text>
                  {settled.map((person) => (
                    <PersonRow key={person.id} person={person} settled />
                  ))}
                </>
              )}
            </View>
          </>
        )}
      </LendingScroll>
      <AddEntryButton />
    </>
  );
}

export default function LendingScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Lending' }} />
      <LendingBoundary title="lending" section="People" subject="lending">
        <LendingOverview />
      </LendingBoundary>
    </>
  );
}

function CardContent() {
  const { data: people, error, isFetching, refetch } = useSuspenseQuery(lendingOverviewQuery());
  return (
    <View style={panel}>
      {!!error && !isFetching && (
        <LendingAlert refresh message="Could not refresh lending" retry={() => void refetch()} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Lending"
        style={{ gap: 12 }}
        onPress={() => router.push('/accounts/lending')}
      >
        <View style={spacedRow}>
          <Muted>Lending</Muted>
          <Muted>
            {people.length ? `${countLabel(people.length, 'person', 'people')} ›` : '›'}
          </Muted>
        </View>
        {people.every((person) => !person.totals.length) ? (
          <Text style={{ color: colors.text }}>Nothing lent or borrowed yet</Text>
        ) : (
          <OpenTotals compact totals={people.flatMap((person) => person.totals)} />
        )}
      </Pressable>
    </View>
  );
}

export function LendingCard() {
  return (
    <QueryBoundary
      pending={
        <View style={panel} accessibilityRole="progressbar" accessibilityLabel="Loading lending">
          <Skeleton width="30%" />
          <View style={spacedRow}>
            <Skeleton width="40%" height={22} />
            <Skeleton width="30%" height={22} />
          </View>
        </View>
      }
      error={(retry) => (
        <View style={panel}>
          <LendingAlert refresh message="Could not load lending" retry={retry} />
        </View>
      )}
    >
      <CardContent />
    </QueryBoundary>
  );
}
