import { useSuspenseQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { QueryBoundary } from '@/components/query-error-boundary';
import { addTransfer } from '@/lib/transfers';
import { accountsQuery } from '@/lib/account-queries';
import {
  TransferForm,
  TransferFormError,
  TransferFormSkeleton,
  type TransferFormProps,
} from './view.tsx';

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
  return (
    <TransferFormSection
      intro="Move money between your accounts."
      submitLabel="Save transfer"
      onSubmit={async ({ amountMinor, fromAccountId, toAccountId, note }) => {
        await addTransfer({ amountMinor, fromAccountId, toAccountId, note });
        router.back();
      }}
    />
  );
}
