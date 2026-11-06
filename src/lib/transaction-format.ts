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

export function formatActivityDay(day: number, now = new Date()): string {
  const today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  if (day === today) return 'Today';
  if (day === today - 1) return 'Yesterday';
  return formatEpochDay(day);
}

/** Like formatTransactionAmount, but Taka uses its symbol with Bangladeshi grouping. */
export function formatMoney(type: 'EXPENSE' | 'INCOME' | 'TRANSFER', minor: number, currency: string): string {
  if (currency !== 'BDT') return formatTransactionAmount(type, minor, currency);
  const sign = type === 'EXPENSE' ? '−' : type === 'INCOME' ? '+' : '';
  return `${sign}৳${new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
}

export function formatBalance(minor: number, currency: string): string {
  return `${minor < 0 ? '−' : ''}${formatMoney('TRANSFER', Math.abs(minor), currency)}`;
}
