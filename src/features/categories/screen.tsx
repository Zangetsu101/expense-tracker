import { useState } from 'react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import { CategoryBrowser } from '@/components/category-browser';
import {
  applyCategoryEmojiSuggestions,
  categoryEmojiSuggestions,
  createCategory,
  listCategoryEmojiDismissals,
  type CategoryEmojiSuggestion,
  updateCategory,
  type CreateCategoryInput,
  type ManagedCategory,
} from '@/lib/categories';
import { EmojiReview } from './emoji-review';
import { managedCategoriesQuery } from './queries.ts';
import { CategoriesError, CategoriesLayout, CategoriesSkeleton, RefreshAlert } from './view.tsx';

async function save(input: CreateCategoryInput, editing?: ManagedCategory) {
  if (editing) await updateCategory(editing.id, input.name, input.emoji);
  else await createCategory(input);
}

function CategoriesContent({ dismissals }: { dismissals?: string[] }) {
  const { data, error, isFetching, refetch } = useSuspenseQuery(managedCategoriesQuery());
  const [review, setReview] = useState<CategoryEmojiSuggestion[] | null>(null);
  const [notice, setNotice] = useState<string>();
  const suggestions = dismissals ? categoryEmojiSuggestions(data, dismissals) : [];

  async function applyIcons(suggestions: CategoryEmojiSuggestion[], ids: number[]) {
    const count = await applyCategoryEmojiSuggestions(suggestions, ids);
    setNotice(count === 1 ? '1 category icon applied.' : `${count} category icons applied.`);
  }

  return (
    <>
      {!!error && !isFetching && <RefreshAlert retry={() => void refetch()} />}
      <CategoryBrowser
        items={data}
        onSave={save}
        disabled={isFetching}
        onReviewIcons={suggestions.length ? () => setReview(suggestions) : undefined}
        iconNotice={notice}
      />
      {review && (
        <EmojiReview suggestions={review} onApply={applyIcons} onClose={() => setReview(null)} />
      )}
    </>
  );
}

export default function CategoriesScreen() {
  const dismissals = useQuery({
    queryKey: ['categories', 'emoji-dismissals'],
    queryFn: listCategoryEmojiDismissals,
  });
  return (
    <CategoriesLayout>
      {dismissals.isError && (
        <RefreshAlert
          label="Could not load icon suggestions."
          retry={() => void dismissals.refetch()}
        />
      )}
      <QueryBoundary
        pending={<CategoriesSkeleton />}
        error={(retry) => <CategoriesError retry={retry} />}
      >
        <CategoriesContent dismissals={dismissals.isFetching ? undefined : dismissals.data} />
      </QueryBoundary>
    </CategoriesLayout>
  );
}
