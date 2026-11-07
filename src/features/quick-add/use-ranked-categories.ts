import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Account } from '@/lib/database';
import type { CategoryType, ManagedCategory } from '@/lib/categories';
import { rankCategoryIds } from '@/lib/category-prediction';
import { categoryEvidenceQuery } from './queries.ts';

export function useRankedCategories(
  categories: ManagedCategory[] | undefined,
  type: CategoryType | undefined,
  account: Account | undefined,
  amountMinor: number | undefined,
  day: number,
) {
  const evidence = useQuery({
    ...categoryEvidenceQuery(type ?? 'EXPENSE', account?.currencyCode ?? ''),
    enabled: !!type && !!account && !!amountMinor,
  });
  return useMemo(() => {
    if (!categories || !account || !evidence.data || !amountMinor) return undefined;
    return rankCategoryIds(
      categories.map((category) => category.id),
      evidence.data,
      amountMinor,
      account.id,
      day,
    );
  }, [categories, account, evidence.data, amountMinor, day]);
}
