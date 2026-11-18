import { queryOptions } from '@tanstack/react-query';
import { loadEditableTransaction, type EditableTransaction } from '@/lib/transaction-edit';
import { loadTransfer, type EditableTransfer } from '@/lib/transfers';

import { loadLendingEntry, type LendingEntry } from '@/lib/lending';

export type WriteOffReceipt = LendingEntry & {
  type: 'WRITE_OFF';
  kind: 'WRITE_OFF_LENT' | 'WRITE_OFF_BORROWED';
};

export type Receipt = EditableTransaction | EditableTransfer | WriteOffReceipt;

/** Reads a Transaction or a Transfer. The result is null when neither exists. */
export function receiptQuery(id: number, writeOff = false) {
  return queryOptions({
    queryKey: writeOff ? ['receipt', 'write-off', id] : ['receipt', id],
    queryFn: async (): Promise<Receipt | null> => {
      if (!writeOff) return (await loadEditableTransaction(id)) ?? (await loadTransfer(id));
      const entry = await loadLendingEntry(id);
      if (!entry || entry.transactionId !== null) return null;
      if (entry.kind !== 'WRITE_OFF_LENT' && entry.kind !== 'WRITE_OFF_BORROWED') return null;
      return { ...entry, type: 'WRITE_OFF', kind: entry.kind };
    },
  });
}
