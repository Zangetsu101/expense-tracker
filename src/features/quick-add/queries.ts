import { creditCardBills } from '@/lib/credit-cards';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { listCategoriesByRecentUse, type CategoryType } from '@/lib/categories';
import { listPeople, listLendingTotals, type Person } from '@/lib/lending';
import { listCategoryEvidence } from '@/lib/category-prediction-history';

const quickAddKey = ['quick-add'] as const;

export function cardBillsQuery(today: number) {
  return queryOptions({
    queryKey: ['accounts', 'bills', today],
    queryFn: () => creditCardBills(today),
  });
}

export function categoryEvidenceQuery(type: 'EXPENSE' | 'INCOME', currency: string) {
  return queryOptions({
    queryKey: [...quickAddKey, 'category-evidence', type, currency],
    queryFn: () => listCategoryEvidence(type, currency),
  });
}

export function categoriesQuery(type: CategoryType) {
  return queryOptions({
    queryKey: [...quickAddKey, 'categories', type],
    queryFn: () => listCategoriesByRecentUse(type),
  });
}

export function peopleQuery() {
  return queryOptions({
    queryKey: [...quickAddKey, 'people'],
    queryFn: async () => {
      const [people, totals] = await Promise.all([listPeople(), listLendingTotals()]);
      return { people, totals };
    },
  });
}

/** SQLite gives a new row the next ID after the largest ID. */
export function nextPersonId(people: readonly Person[]): number {
  return Math.max(0, ...people.map(({ id }) => id)) + 1;
}

export function includeCreatedPerson(client: QueryClient, person: Person) {
  client.setQueryData(
    peopleQuery().queryKey,
    (data) =>
      data && {
        ...data,
        people: [...data.people.filter((item) => item.id !== person.id), person].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      },
  );
}
