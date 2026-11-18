import { useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { FormButton, FormInput } from '@/components/form-controls';
import { renamePerson, type LendingTotal } from '@/lib/lending';
import { formatBalance } from '@/lib/transaction-format';
import { personLedgerQuery } from './queries.ts';
import { WriteOffForm } from './write-off-form.tsx';
import {
  AddEntryButton,
  EmptyLedger,
  Heading,
  HistoryList,
  LedgerSheet,
  LendingAlert,
  LendingBoundary,
  MoneyText,
  Muted,
  SheetAction,
  colors,
  directionColor,
  divider,
  panel,
  spacedRow,
} from './view.tsx';

function Balance({ total, onPress }: { total: LendingTotal; onPress: () => void }) {
  const lent = total.direction === 'LENT';
  const color = directionColor(total.direction);
  const money = (amount: number) => formatBalance(amount, total.currencyCode);
  const progress = total.principalMinor
    ? Math.min(100, ((total.repaidMinor + total.writtenOffMinor) / total.principalMinor) * 100)
    : 0;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ gap: 8 }}>
      <View style={{ ...spacedRow, alignItems: 'baseline' }}>
        <Muted>
          {lent ? 'Owes you' : 'You owe'} · {total.currencyCode}
        </Muted>
        <MoneyText size={lent ? 22 : 18} color={color}>
          {money(total.outstandingMinor)}{' '}
          <Text style={{ color: colors.muted, fontWeight: '400' }}>›</Text>
        </MoneyText>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.raised }}>
        <View
          style={{ height: 6, borderRadius: 3, width: `${progress}%`, backgroundColor: color }}
        />
      </View>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        {money(total.repaidMinor)} repaid · {money(total.writtenOffMinor)} written off of{' '}
        {money(total.principalMinor)}
      </Text>
      {!!total.overpaidMinor && (
        <Text style={{ color: color }}>Overpaid credit {money(total.overpaidMinor)}</Text>
      )}
    </Pressable>
  );
}

function PersonLedger({ personId }: { personId: number }) {
  const client = useQueryClient();
  const query = personLedgerQuery(personId);
  const { data, error, isFetching, refetch } = useSuspenseQuery(query);
  const { person, entries, totals } = data;
  const [balance, setBalance] = useState<LendingTotal>();
  const [sheet, setSheet] = useState<'balance' | 'write-off' | 'rename'>();
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState('');
  const saving = useRef(false);
  const lent = balance?.direction === 'LENT';
  const writeOffTitle = lent ? 'Write off what they owe' : 'Write off what you owe';
  function quickAdd(action: 'LEND' | 'BORROW' | 'RECEIVE_REPAYMENT' | 'REPAY') {
    setSheet(undefined);
    router.push({
      pathname: '/quick-add',
      params: { personId, mode: 'PERSON', action, currency: balance?.currencyCode },
    });
  }
  async function rename() {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setWriteError('');
    try {
      const updated = await renamePerson(person.id, name);
      client.setQueryData(query.queryKey, (current) => current && { ...current, person: updated });
      router.setParams({ name: updated.name });
      setSheet(undefined);
    } catch (cause) {
      setWriteError(String(cause));
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: person.name,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Person options"
              accessibilityState={{ expanded: menu }}
              onPress={() => setMenu(!menu)}
              style={{
                minWidth: 44,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: colors.text, fontSize: 22 }}>⋮</Text>
            </Pressable>
          ),
        }}
      />
      <HistoryList
        rows={entries}
        header={
          <View style={{ gap: 16 }}>
            {!!error && !isFetching && (
              <LendingAlert
                refresh
                message="Could not refresh this person"
                retry={() => void refetch()}
              />
            )}
            {totals.length ? (
              <>
                <View style={panel}>
                  {[...totals]
                    .sort((a, b) => b.direction.localeCompare(a.direction))
                    .map((total, index) => (
                      <View key={`${total.direction}:${total.currencyCode}`} style={{ gap: 12 }}>
                        {index > 0 && <View style={divider} />}
                        <Balance
                          total={total}
                          onPress={() => {
                            setBalance(total);
                            setSheet('balance');
                          }}
                        />
                      </View>
                    ))}
                </View>
                <View style={{ marginTop: 4 }}>
                  <Heading>History</Heading>
                </View>
              </>
            ) : (
              <EmptyLedger title="No entries yet" hint="Tap + to add an entry for this person." />
            )}
          </View>
        }
        onPress={(entry) =>
          router.push(
            entry.transactionId === null
              ? { pathname: '/transaction/[id]', params: { id: entry.id, kind: 'write-off' } }
              : { pathname: '/transaction/[id]', params: { id: entry.transactionId } },
          )
        }
      />
      <AddEntryButton personId={person.id} />
      {menu && (
        <View style={{ position: 'absolute', inset: 0 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss person options"
            onPress={() => setMenu(false)}
            style={{ flex: 1 }}
          />
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 12,
              minWidth: 200,
              paddingHorizontal: 16,
              borderRadius: 12,
              backgroundColor: colors.raised,
              elevation: 6,
            }}
          >
            <SheetAction
              label="Rename"
              onPress={() => {
                setMenu(false);
                setName(person.name);
                setWriteError('');
                setSheet('rename');
              }}
            />
          </View>
        </View>
      )}
      {sheet && (
        <LedgerSheet dismiss={() => setSheet(undefined)} pending={pending}>
          {sheet === 'rename' ? (
            <>
              <Heading>Rename</Heading>
              <FormInput
                accessibilityLabel="Person name"
                value={name}
                onChangeText={setName}
                editable={!pending}
              />
              {!!writeError && (
                <Text accessibilityRole="alert" style={{ color: colors.warning }}>
                  {writeError}
                </Text>
              )}
              <FormButton
                label="Save name"
                loading={pending}
                disabled={!name.trim()}
                onPress={() => void rename()}
              />
            </>
          ) : (
            balance &&
            (sheet === 'balance' ? (
              <>
                <Heading>
                  {lent ? 'Owes you' : 'You owe'} · {balance.currencyCode}
                </Heading>
                <Muted>{formatBalance(balance.outstandingMinor, balance.currencyCode)}</Muted>
                {!!balance.outstandingMinor && (
                  <SheetAction
                    label={lent ? 'Receive repayment' : 'Repay'}
                    onPress={() => quickAdd(lent ? 'RECEIVE_REPAYMENT' : 'REPAY')}
                  />
                )}
                <SheetAction
                  label={lent ? 'Lend more' : 'Borrow more'}
                  onPress={() => quickAdd(lent ? 'LEND' : 'BORROW')}
                />
                {!!balance.outstandingMinor && (
                  <SheetAction label={writeOffTitle} accent onPress={() => setSheet('write-off')} />
                )}
              </>
            ) : (
              <>
                <Heading>{writeOffTitle}</Heading>
                <Muted>
                  {person.name} · {balance.currencyCode} · no Account movement
                </Muted>
                <WriteOffForm
                  personId={person.id}
                  kind={lent ? 'WRITE_OFF_LENT' : 'WRITE_OFF_BORROWED'}
                  currency={balance.currencyCode}
                  initialAmount={balance.outstandingMinor}
                  onSavingChange={setPending}
                  onSaved={() => setSheet(undefined)}
                />
              </>
            ))
          )}
        </LedgerSheet>
      )}
    </View>
  );
}

export default function PersonScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: name || 'Person' }} />
      <LendingBoundary key={id} title="person" section="History" subject="this person">
        <PersonLedger personId={Number(id)} />
      </LendingBoundary>
    </>
  );
}
