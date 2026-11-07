import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { listAccounts } from '@/lib/database';
import { listCategoriesByRecentUse, type CategoryType } from '@/lib/categories';
import { listPeople, listLendingTotals, type Person } from '@/lib/lending';
import { listCategoryEvidence } from '@/lib/category-prediction-history';

const quickAddKey = ['quick-add'] as const;

export function categoryEvidenceQuery(type: 'EXPENSE' | 'INCOME', currency: string) {
  return queryOptions({
    queryKey: [...quickAddKey, 'category-evidence', type, currency],
    queryFn: () => listCategoryEvidence(type, currency),
  });
}

export function accountsQuery() {
  return queryOptions({ queryKey: [...quickAddKey, 'accounts'], queryFn: listAccounts });
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

export function invalidateQuickAdd(client: QueryClient) {
  return client.invalidateQueries({ queryKey: quickAddKey });
}
