import { useEffect, useRef, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { FormInput } from '@/components/form-controls';
import { assignLendingTransactions } from '@/lib/lending';
import { countLabel, formatBalance } from '@/lib/transaction-format';
import { unassignedHistoryQuery } from './queries.ts';
import {
  EmptyLedger,
  Heading,
  HistoryList,
  LedgerSheet,
  LendingAlert,
  LendingBoundary,
  LendingButton,
  MoneyText,
  Muted,
  SheetAction,
  colors,
  directionColor,
  divider,
  panel,
  spacedRow,
  writeWithOverpaidCreditCheck,
} from './view.tsx';

function UnassignedLedger() {
  const { data, error, isFetching, refetch } = useSuspenseQuery(unassignedHistoryQuery());
  const { rows, totals, people } = data;
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [targets, setTargets] = useState<number[]>();
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState('');
  const [notice, setNotice] = useState('');
  const saving = useRef(false);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2200);
    return () => clearTimeout(timer);
  }, [notice]);
  const activeIds = rows
    .filter((row) => selected.has(row.transactionId))
    .map((row) => row.transactionId);
  const term = search.trim().toLocaleLowerCase();
  const matches = people.filter((person) => person.name.toLocaleLowerCase().includes(term));
  function toggle(id: number) {
    setNotice('');
    setSelected((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function assign(target: string | number) {
    if (!targets || saving.current) return;
    saving.current = true;
    setPending(true);
    setWriteError('');
    try {
      const assigned = await writeWithOverpaidCreditCheck(
        (confirmOverpayment) => assignLendingTransactions(targets, target, { confirmOverpayment }),
        'Assign anyway',
      );
      if (!assigned) return;
      const { result } = assigned;
      if (result.status === 'saved') {
        setSelected(new Set());
        setTargets(undefined);
        setNotice(
          `${countLabel(result.ids.length, 'entry', 'entries')} assigned to ${result.person.name}`,
        );
      }
    } catch (cause) {
      setWriteError(String(cause));
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <HistoryList
        rows={rows}
        selection={selected}
        onPress={(row) => toggle(row.transactionId)}
        header={
          <View style={{ gap: 16 }}>
            {!!error && !isFetching && (
              <LendingAlert
                refresh
                message="Could not refresh the entries"
                retry={() => void refetch()}
              />
            )}
            {rows.length ? (
              <>
                <View style={panel}>
                  {[...totals]
                    .sort((a, b) => b.direction.localeCompare(a.direction))
                    .map((total, index) => (
                      <View key={`${total.direction}:${total.currencyCode}`} style={{ gap: 12 }}>
                        {index > 0 && <View style={divider} />}
                        <View style={{ ...spacedRow, alignItems: 'baseline' }}>
                          <Muted>
                            {total.direction === 'LENT' ? 'Owed to you' : 'You owe'} ·{' '}
                            {total.currencyCode}
                          </Muted>
                          <MoneyText
                            size={total.direction === 'LENT' ? 22 : 18}
                            color={directionColor(total.direction)}
                          >
                            {formatBalance(total.outstandingMinor, total.currencyCode)}
                          </MoneyText>
                        </View>
                        {!!total.overpaidMinor && (
                          <Muted>
                            Overpaid credit {formatBalance(total.overpaidMinor, total.currencyCode)}
                          </Muted>
                        )}
                      </View>
                    ))}
                </View>
                <View style={{ ...spacedRow, alignItems: 'center', marginTop: 4 }}>
                  <Heading>Entries</Heading>
                  <Pressable
                    accessibilityRole="button"
                    style={{ padding: 8 }}
                    onPress={() =>
                      setSelected(
                        new Set(activeIds.length ? [] : rows.map((row) => row.transactionId)),
                      )
                    }
                  >
                    <Text style={{ color: colors.accent }}>
                      {activeIds.length ? 'Clear' : 'Select all'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <EmptyLedger
                title="No entries without a person"
                hint="Go to Lending and tap + to add an entry for a person."
              />
            )}
          </View>
        }
      />
      {!!activeIds.length && (
        <View
          style={{
            ...spacedRow,
            alignItems: 'center',
            backgroundColor: colors.surface,
            paddingHorizontal: 20,
            paddingVertical: 14,
          }}
        >
          <Text style={{ color: colors.text }}>{activeIds.length} selected</Text>
          <LendingButton
            label="Assign…"
            onPress={() => {
              setSearch('');
              setWriteError('');
              setTargets(activeIds);
            }}
          />
        </View>
      )}
      {!!notice && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 16,
            right: 20,
            left: 20,
            backgroundColor: colors.raised,
            borderRadius: 12,
            padding: 14,
          }}
        >
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
            {notice}
          </Text>
        </View>
      )}
      {targets && (
        <LedgerSheet pending={pending} dismiss={() => setTargets(undefined)}>
          <Heading>
            {targets.length === 1 ? 'Assign the entry to' : `Assign ${targets.length} entries to`}
          </Heading>
          <FormInput
            accessibilityLabel="Find or add a person"
            placeholder="Find or add a person"
            value={search}
            onChangeText={setSearch}
            editable={!pending}
          />
          {matches.map((person) => (
            <SheetAction
              key={person.id}
              label={person.name}
              disabled={pending}
              onPress={() => void assign(person.id)}
            />
          ))}
          {!!term && !matches.some((person) => person.name.toLocaleLowerCase() === term) && (
            <SheetAction
              label={`Add ${search.trim()}`}
              accent
              disabled={pending}
              onPress={() => void assign(search.trim())}
            />
          )}
          {!!writeError && (
            <Text accessibilityRole="alert" style={{ color: colors.warning }}>
              {writeError}
            </Text>
          )}
        </LedgerSheet>
      )}
    </View>
  );
}

export default function UnassignedScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'No person' }} />
      <LendingBoundary title="entries" section="Entries" subject="the entries">
        <UnassignedLedger />
      </LendingBoundary>
    </>
  );
}
