import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import { CategoryBrowser, type CategorySave } from '@/components/category-browser';
import {
  createCategory,
  renameCategory,
  type CreateCategoryInput,
  type ManagedCategory,
} from '@/lib/categories';
import { managedCategoriesQuery } from './queries.ts';
import { CategoriesError, CategoriesLayout, CategoriesSkeleton, RefreshAlert } from './view.tsx';

type Write = { input: CreateCategoryInput; editing?: ManagedCategory };

function CategoriesContent() {
  const { data, error, isFetching, refetch } = useSuspenseQuery(managedCategoriesQuery());
  const write = useMutation({
    mutationFn: async ({ input, editing }: Write) => {
      if (editing) await renameCategory(editing.id, input.name);
      else await createCategory(input);
    },
  });
  const save: CategorySave = {
    pending: write.isPending,
    error: !write.error
      ? undefined
      : write.error instanceof Error
        ? write.error.message
        : 'Could not save the category. Try again.',
    start: (input, editing, saved) => write.mutate({ input, editing }, { onSuccess: saved }),
    clearError: write.reset,
  };
  return (
    <>
      {!!error && !isFetching && <RefreshAlert retry={() => void refetch()} />}
      <CategoryBrowser items={data} save={save} disabled={isFetching} />
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
