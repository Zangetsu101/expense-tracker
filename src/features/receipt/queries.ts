import { reimbursementReceipt } from '@/features/home/read-home';
import { queryOptions } from '@tanstack/react-query';
import { loadEditableTransaction, type EditableTransaction } from '@/lib/transaction-edit';
import { loadTransfer, type EditableTransfer } from '@/lib/transfers';
import { loadLendingEntry, type WriteOffEntry } from '@/lib/lending';

export type Receipt =
  | (EditableTransaction & {
      reimbursementDetails?: Awaited<ReturnType<typeof reimbursementReceipt>>;
    })
  | EditableTransfer
  | WriteOffEntry;

/** Reads a Transaction or a Transfer. The result is null when neither exists. */
export function receiptQuery(id: number) {
  return queryOptions({
    queryKey: ['receipt', id],
    queryFn: async (): Promise<Receipt | null> => {
      const row = await loadEditableTransaction(id);
      if (!row) return loadTransfer(id);
      return { ...row, reimbursementDetails: await reimbursementReceipt(id, row.type) };
    },
  });
}

/** Reads a write-off by its lending entry id. The result is null for other entries. */
export function writeOffReceiptQuery(id: number) {
  return queryOptions({
    queryKey: ['receipt', 'write-off', id],
    queryFn: async (): Promise<Receipt | null> => {
      const entry = await loadLendingEntry(id);
      if (!entry || entry.transactionId !== null) return null;
      if (entry.kind !== 'WRITE_OFF_LENT' && entry.kind !== 'WRITE_OFF_BORROWED') return null;
      return { ...entry, type: 'WRITE_OFF', kind: entry.kind };
    },
  });
}
