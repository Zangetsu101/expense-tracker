import { queryOptions } from '@tanstack/react-query';
import { listReviewCandidates } from '@/lib/review-queue';

export function reviewCandidatesQuery() {
  return queryOptions({ queryKey: ['review-queue', 'candidates'], queryFn: listReviewCandidates });
}
