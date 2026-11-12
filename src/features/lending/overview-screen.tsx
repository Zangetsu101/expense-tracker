import { useState } from 'react';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { createPerson } from '@/lib/lending';
import { FormButton, FormInput } from '@/components/form-controls';
import { QueryBoundary } from '@/components/query-error-boundary';
import { theme } from '@/theme';
import { lendingOverviewQuery } from './queries.ts';
import { ButtonSkeleton, LendingAlert, LoadingGroup } from './view.tsx';

const c = theme.colors;

function LendingOverview() {
  const { data, error, isFetching, refetch } = useSuspenseQuery(lendingOverviewQuery());
  return (
    <>
      {!!error && !isFetching && (
        <LendingAlert message="Could not refresh people." retry={() => void refetch()} />
      )}
      <FormButton
        label={`Unassigned historical entries (${data.unassignedCount})`}
        variant="secondary"
        onPress={() => router.push('/lending/unassigned')}
      />
      {data.people.length === 0 && (
        <Text style={{ color: c.muted }}>
          No saved people yet. Save a person to start recording lending or borrowing.
        </Text>
      )}
      {data.people.map((person) => (
        <FormButton
          key={person.id}
          label={person.name}
          variant="secondary"
          onPress={() => router.push({ pathname: '/lending/person', params: { id: person.id } })}
        />
      ))}
    </>
  );
}

function LendingOverviewSkeleton() {
  return (
    <LoadingGroup label="Loading people">
      <ButtonSkeleton />
      <ButtonSkeleton />
      <ButtonSkeleton />
      <ButtonSkeleton />
    </LoadingGroup>
  );
}

export default function LendingScreen() {
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: (personName: string) => createPerson(personName),
    onSuccess: (person) => {
      setName('');
      router.push({ pathname: '/lending/person', params: { id: person.id } });
    },
  });
  return (
    <>
      <Stack.Screen options={{ title: 'Lending & borrowing' }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.background }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}
      >
        <Text style={{ color: c.muted }}>
          People are shared across lending and borrowing. Balances stay separate by direction and
          currency.
        </Text>
        <FormButton label="Add money movement" onPress={() => router.push('/lending/entry')} />
        <FormInput
          accessibilityLabel="New person name"
          placeholder="Person’s name"
          value={name}
          onChangeText={setName}
          editable={!add.isPending}
        />
        <FormButton
          label="Save person"
          variant="secondary"
          disabled={!name.trim()}
          loading={add.isPending}
          onPress={() => add.mutate(name)}
        />
        {!!add.error && (
          <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
            {String(add.error)}
          </Text>
        )}
        <View style={{ gap: 16 }}>
          <QueryBoundary
            pending={<LendingOverviewSkeleton />}
            error={(retry) => <LendingAlert message="Could not load people." retry={retry} />}
          >
            <LendingOverview />
          </QueryBoundary>
        </View>
      </ScrollView>
    </>
  );
}
