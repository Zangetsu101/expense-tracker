import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { QueryBoundary } from '@/components/query-error-boundary';
import { addTransfer } from '@/lib/transfers';
import { accountsQuery } from '@/lib/account-queries';
import {
  TransferForm,
  TransferFormError,
  TransferFormSkeleton,
  type TransferDraft,
  type TransferFormProps,
} from './view.tsx';

/** The text of a failed save, without the "Error:" prefix. */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ReadyTransferForm(props: TransferFormProps) {
  const { data, error, isFetching, refetch } = useSuspenseQuery(accountsQuery());
  return (
    <TransferForm
      {...props}
      accounts={data}
      fetching={isFetching}
      refreshFailed={!!error && !isFetching}
      onRetry={() => void refetch()}
    />
  );
}

/** The transfer form below its accounts boundary. The Receipt screen also uses it. */
export function TransferFormSection(props: TransferFormProps) {
  return (
    <QueryBoundary
      pending={<TransferFormSkeleton intro={props.intro} />}
      error={(retry) => <TransferFormError intro={props.intro} retry={retry} />}
    >
      <ReadyTransferForm {...props} />
    </QueryBoundary>
  );
}

export default function TransferScreen() {
  const add = useMutation({
    mutationFn: ({ amountMinor, fromAccountId, toAccountId, note }: TransferDraft) =>
      addTransfer({ amountMinor, fromAccountId, toAccountId, note }),
    onSuccess: () => router.back(),
  });
  return (
    <TransferFormSection
      intro="Move money between your accounts."
      submitLabel="Save transfer"
      pending={add.isPending}
      error={add.error ? errorMessage(add.error) : undefined}
      onSubmit={(draft) => add.mutate(draft)}
      onClearError={add.reset}
    />
  );
}
