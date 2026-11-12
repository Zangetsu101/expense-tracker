import { queryOptions } from '@tanstack/react-query';
import { loadEditableTransaction, type EditableTransaction } from '@/lib/transaction-edit';
import { loadTransfer, type EditableTransfer } from '@/lib/transfers';

export type Receipt = EditableTransaction | EditableTransfer;

/** Reads a Transaction or a Transfer. The result is null when neither exists. */
export function receiptQuery(id: number) {
  return queryOptions({
    queryKey: ['receipt', id],
    queryFn: async (): Promise<Receipt | null> =>
      (await loadEditableTransaction(id)) ?? (await loadTransfer(id)),
  });
}
