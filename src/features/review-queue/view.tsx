import type { ReactNode } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { ReviewCandidate } from '@/lib/review-queue';
import { FormButton } from '@/components/form-controls';
import { Skeleton } from '@/components/loading';
import { theme } from '@/theme';

const c = theme.colors;
const listStyle = { padding: 20, gap: 12 };
const cardStyle = { padding: 16, borderRadius: 12, gap: 8 };

function CandidateCard({
  candidate,
  disabled,
  onConfirm,
  onReject,
}: {
  candidate: ReviewCandidate;
  disabled: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  return (
    <View style={{ ...cardStyle, backgroundColor: '#e8eaf0' }}>
      <Text selectable style={{ fontWeight: '600' }}>
        {candidate.outgoingAccount} → {candidate.incomingAccount}
      </Text>
      <Text selectable>
        {(candidate.amountMinor / 100).toFixed(2)} {candidate.currencyCode} ·{' '}
        {new Date(candidate.date * 86400000).toISOString().slice(0, 10)}
      </Text>
      <Text selectable>{candidate.confidenceNote}</Text>
      {candidate.outgoingNote && <Text selectable>Outgoing: {candidate.outgoingNote}</Text>}
      {candidate.incomingNote && <Text selectable>Incoming: {candidate.incomingNote}</Text>}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onConfirm}
          style={{ padding: 12, backgroundColor: '#315fcb', borderRadius: 8 }}
        >
          <Text style={{ color: 'white' }}>Confirm transfer</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onReject}
          style={{ padding: 12 }}
        >
          <Text>Reject match</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function CandidatesView({
  candidates,
  disabled,
  refreshFailed,
  onRetry,
  onConfirm,
  onReject,
}: {
  candidates: ReviewCandidate[];
  disabled: boolean;
  refreshFailed: boolean;
  onRetry: () => void;
  onConfirm: (id: number) => void;
  onReject: (id: number) => void;
}) {
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={listStyle}
      data={candidates}
      keyExtractor={(row) => String(row.id)}
      ListHeaderComponent={
        refreshFailed ? (
          <ReviewQueueAlert message="Could not refresh transfer candidates." retry={onRetry} />
        ) : candidates.length === 0 ? (
          <Text style={{ color: c.text }}>No transfer candidates to review.</Text>
        ) : null
      }
      renderItem={({ item }) => (
        <CandidateCard
          candidate={item}
          disabled={disabled}
          onConfirm={() => onConfirm(item.id)}
          onReject={() => onReject(item.id)}
        />
      )}
    />
  );
}

function ReviewQueueAlert({ message, retry }: { message: string; retry: () => void }) {
  return (
    <View style={{ gap: 12 }}>
      <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
        {message}
      </Text>
      <FormButton label="Retry" variant="secondary" onPress={retry} />
    </View>
  );
}

function FallbackList({ children }: { children: ReactNode }) {
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={listStyle}
      data={[]}
      renderItem={() => null}
      ListHeaderComponent={<View style={{ gap: 12 }}>{children}</View>}
    />
  );
}

export function ReviewQueueSkeleton() {
  return (
    <FallbackList>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Loading transfer candidates"
        style={{ gap: 12 }}
      >
        {[0, 1, 2].map((key) => (
          <View key={key} style={{ ...cardStyle, backgroundColor: c.surface }}>
            <Skeleton width="55%" height={18} />
            <Skeleton width="40%" />
            <Skeleton width="70%" />
            <View style={{ flexDirection: 'row', gap: 12, paddingTop: 4 }}>
              <Skeleton width={140} height={44} borderRadius={8} />
              <Skeleton width={110} height={44} borderRadius={8} />
            </View>
          </View>
        ))}
      </View>
    </FallbackList>
  );
}

export function ReviewQueueError({ retry }: { retry: () => void }) {
  return (
    <FallbackList>
      <ReviewQueueAlert message="Could not load transfer candidates." retry={retry} />
    </FallbackList>
  );
}
