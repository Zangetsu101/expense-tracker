import { useState } from 'react';
import { Alert } from 'react-native';
import { useSuspenseQuery } from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import { confirmCandidate, rejectCandidate } from '@/lib/review-queue';
import { reviewCandidatesQuery } from './queries.ts';
import { CandidatesView, ReviewQueueError, ReviewQueueSkeleton } from './view.tsx';

type Action = 'confirm' | 'reject';

function Candidates() {
  const { data, error, isFetching, refetch } = useSuspenseQuery(reviewCandidatesQuery());
  const [pending, setPending] = useState<number | null>(null);
  const resolve = async (id: number, action: Action) => {
    setPending(id);
    try {
      if (action === 'confirm') await confirmCandidate(id);
      else await rejectCandidate(id);
    } catch (cause) {
      Alert.alert('Could not resolve candidate', String(cause));
      void refetch();
    } finally {
      setPending(null);
    }
  };
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
          onPress: () => void resolve(id, action),
        },
      ],
    );
  return (
    <CandidatesView
      candidates={data}
      disabled={pending !== null || isFetching}
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
