import { View } from 'react-native';
import type { Account } from '@/lib/database';
import { epochDay } from '@/lib/database';
import { formatBalance } from '@/lib/transaction-format';
import { FormButton } from '@/components/form-controls';
import { ChoicesSection } from './view.tsx';
import { cardBillsQuery } from './queries.ts';

export function TransferBillChoices({
  destination,
  disabled,
  onPreset,
}: {
  destination?: Account;
  disabled: boolean;
  onPreset: (receivedAmountMinor: number) => void;
}) {
  return (
    <ChoicesSection
      options={cardBillsQuery(epochDay(new Date()))}
      label="card bills"
      layout="bills"
    >
      {(bills) =>
        bills
          .filter((bill) => bill.accountId === destination?.id)
          .map((bill) => (
            <View key={bill.accountId} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[
                { label: 'Bill', amount: bill.billMinor },
                { label: 'All owed', amount: bill.owedMinor },
              ]
                .filter((choice) => choice.amount > 0)
                .map((choice) => (
                  <FormButton
                    key={choice.label}
                    label={`${choice.label} · ${formatBalance(choice.amount, destination!.currencyCode)}`}
                    variant="secondary"
                    disabled={disabled}
                    onPress={() => onPreset(choice.amount)}
                  />
                ))}
            </View>
          ))
      }
    </ChoicesSection>
  );
}
