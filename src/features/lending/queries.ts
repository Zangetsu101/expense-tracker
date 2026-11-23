import { queryOptions } from '@tanstack/react-query';
import { listPeopleWithLendingTotals, loadPersonLedger } from '@/lib/lending';

export function lendingOverviewQuery() {
  return queryOptions({
    queryKey: ['lending', 'overview'],
    queryFn: listPeopleWithLendingTotals,
  });
}

export function personLedgerQuery(id: number) {
  return queryOptions({
    queryKey: ['lending', 'person', id],
    queryFn: () => loadPersonLedger(id),
  });
}
