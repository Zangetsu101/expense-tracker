import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { listAccounts } from '@/lib/database';
import {
  listLendingEntries,
  listLendingTotals,
  listPeople,
  listUnassignedLendingTransactions,
  type Person,
} from '@/lib/lending';

const lendingKey = ['lending'] as const;

export function lendingOverviewQuery() {
  return queryOptions({
    queryKey: [...lendingKey, 'overview'],
    queryFn: async () => {
      const [people, unassigned] = await Promise.all([
        listPeople(),
        listUnassignedLendingTransactions(),
      ]);
      return { people, unassignedCount: unassigned.length };
    },
  });
}

export function personLedgerQuery(personId: number) {
  return queryOptions({
    queryKey: [...lendingKey, 'person', personId],
    queryFn: async () => {
      const [people, entries, totals] = await Promise.all([
        listPeople(),
        listLendingEntries(personId),
        listLendingTotals(personId),
      ]);
      const person = people.find((item) => item.id === personId);
      if (!person) throw new Error('Person not found.');
      return { person, entries, totals };
    },
  });
}

export function unassignedHistoryQuery() {
  return queryOptions({
    queryKey: [...lendingKey, 'unassigned'],
    queryFn: async () => {
      const [rows, people] = await Promise.all([listUnassignedLendingTransactions(), listPeople()]);
      return { rows, people };
    },
  });
}

export function lendingEntryFormQuery(id: number | undefined) {
  return queryOptions({
    queryKey: [...lendingKey, 'entry-form', id ?? null],
    // The form takes its first values from this read. Do not keep the result after the
    // screen closes, so that the next form starts from a new read.
    gcTime: 0,
    queryFn: async () => {
      const [people, accounts, entries] = await Promise.all([
        listPeople(),
        listAccounts(),
        id ? listLendingEntries() : Promise.resolve([]),
      ]);
      const entry = id ? entries.find((item) => item.id === id) : undefined;
      if (id && !entry) throw new Error('Entry not found.');
      return { people, accounts, entry };
    },
  });
}

export function includeCreatedPerson(client: QueryClient, id: number | undefined, person: Person) {
  client.setQueryData(
    lendingEntryFormQuery(id).queryKey,
    (data) => data && { ...data, people: [...data.people, person] },
  );
}
