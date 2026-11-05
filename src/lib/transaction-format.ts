export function formatTransactionAmount(type: 'EXPENSE' | 'INCOME' | 'TRANSFER', amountMinor: number, currencyCode: string): string {
  const sign = type === 'EXPENSE' ? '−' : type === 'INCOME' ? '+' : '';
  let value: string;
  try {
    value = new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(amountMinor / 100);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    value = `${(amountMinor / 100).toFixed(2)} ${currencyCode}`;
  }
  return sign + value;
}

export function formatEpochDay(day: number): string {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

export function countLabel(count: number, singular: string, plural: string, hasMorePages = false): string {
  return `${count}${hasMorePages ? '+' : ''} ${count === 1 && !hasMorePages ? singular : plural}`;
}

export type LendingLabel = {
  lendingKind?: 'LEND' | 'BORROW' | 'RECEIVE_REPAYMENT' | 'REPAY' | null;
  personName?: string | null;
};

export function transactionTitle(row: LendingLabel & { type: 'EXPENSE' | 'INCOME' | 'TRANSFER'; categoryName: string | null; categoryPath?: string | null }): string {
  if (row.lendingKind && row.personName) {
    const prefixes = { LEND: 'Lent to', BORROW: 'Borrowed from', RECEIVE_REPAYMENT: 'Repayment from', REPAY: 'Repaid to' };
    return `${prefixes[row.lendingKind]} ${row.personName}`;
  }
  if (row.type === 'TRANSFER') return 'Transfer';
  return row.categoryPath ?? row.categoryName ?? (row.type === 'EXPENSE' ? 'Expense' : 'Income');
}
