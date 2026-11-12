import { useSuspenseQuery } from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import { CategoryBrowser } from '@/components/category-browser';
import {
  createCategory,
  updateCategory,
  type CreateCategoryInput,
  type ManagedCategory,
} from '@/lib/categories';
import { managedCategoriesQuery } from './queries.ts';
import { CategoriesError, CategoriesLayout, CategoriesSkeleton, RefreshAlert } from './view.tsx';

async function save(input: CreateCategoryInput, editing?: ManagedCategory) {
  if (editing) await updateCategory(editing.id, input.name, input.emoji);
  else await createCategory(input);
}

function CategoriesContent() {
  const { data, error, isFetching, refetch } = useSuspenseQuery(managedCategoriesQuery());
  return (
    <>
      {!!error && !isFetching && <RefreshAlert retry={() => void refetch()} />}
      <CategoryBrowser items={data} onSave={save} disabled={isFetching} />
    </>
  );
}

export default function CategoriesScreen() {
  return (
    <CategoriesLayout>
      <QueryBoundary
        pending={<CategoriesSkeleton />}
        error={(retry) => <CategoriesError retry={retry} />}
      >
        <CategoriesContent />
      </QueryBoundary>
    </CategoriesLayout>
  );
}
