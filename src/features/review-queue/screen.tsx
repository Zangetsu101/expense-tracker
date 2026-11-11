import { Alert } from 'react-native';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import { confirmCandidate, rejectCandidate } from '@/lib/review-queue';
import { reviewCandidatesQuery } from './queries.ts';
import { CandidatesView, ReviewQueueError, ReviewQueueSkeleton } from './view.tsx';

type Action = 'confirm' | 'reject';

function Candidates() {
  const { data, error, isFetching, refetch } = useSuspenseQuery(reviewCandidatesQuery());
  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: number; action: Action }) =>
      action === 'confirm' ? confirmCandidate(id) : rejectCandidate(id),
    onError: (cause) => {
      Alert.alert('Could not resolve candidate', String(cause));
      void refetch();
    },
  });
  const ask = (id: number, action: Action) =>
    Alert.alert(
      action === 'confirm' ? 'Confirm transfer?' : 'Keep separate transactions?',
      action === 'confirm'
        ? 'Merge these two rows into one transfer.'
        : 'Reject this match without changing either transaction.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action === 'confirm' ? 'Confirm' : 'Reject',
          onPress: () => resolve.mutate({ id, action }),
        },
      ],
    );
  return (
    <CandidatesView
      candidates={data}
      disabled={resolve.isPending || isFetching}
      refreshFailed={!!error && !isFetching}
      onRetry={() => void refetch()}
      onConfirm={(id) => ask(id, 'confirm')}
      onReject={(id) => ask(id, 'reject')}
    />
  );
}

export default function ReviewQueueScreen() {
  return (
    <QueryBoundary
      pending={<ReviewQueueSkeleton />}
      error={(retry) => <ReviewQueueError retry={retry} />}
    >
      <Candidates />
    </QueryBoundary>
  );
}
