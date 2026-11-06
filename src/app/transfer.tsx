import { router } from 'expo-router';
import { addTransfer } from '@/lib/transfers';
import { TransferForm, useAccounts } from '@/components/transfer-form';

export default function TransferScreen() {
  const { accounts, loading, error } = useAccounts();
  return (
    <TransferForm
      accounts={accounts}
      loading={loading}
      loadError={error}
      intro="Move money between your accounts."
      submitLabel="Save transfer"
      onSubmit={async ({ amountMinor, fromAccountId, toAccountId, note }) => {
        await addTransfer({ amountMinor, fromAccountId, toAccountId, note });
        router.back();
      }}
    />
  );
}
