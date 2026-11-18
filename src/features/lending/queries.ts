import { queryOptions } from '@tanstack/react-query';
import {
  listPeople,
  listPeopleWithLendingTotals,
  loadPersonLedger,
  loadUnassignedLending,
} from '@/lib/lending';

export function lendingOverviewQuery() {
  return queryOptions({
    queryKey: ['lending', 'overview'],
    queryFn: async () => {
      const [people, unassigned] = await Promise.all([
        listPeopleWithLendingTotals(),
        loadUnassignedLending(),
      ]);
      return { people, unassigned };
    },
  });
}

export function personLedgerQuery(id: number) {
  return queryOptions({
    queryKey: ['lending', 'person', id],
    queryFn: () => loadPersonLedger(id),
  });
}

export function unassignedHistoryQuery() {
  return queryOptions({
    queryKey: ['lending', 'unassigned'],
    queryFn: async () => {
      const [ledger, people] = await Promise.all([loadUnassignedLending(), listPeople()]);
      return { ...ledger, people };
    },
  });
}
