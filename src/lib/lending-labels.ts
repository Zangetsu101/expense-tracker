import type { LendingKind } from './lending.ts';

export const lendingKindLabels: Record<LendingKind, string> = {
  LEND: 'Lent',
  BORROW: 'Borrowed',
  RECEIVE_REPAYMENT: 'Repayment received',
  REPAY: 'Repaid',
  WRITE_OFF_LENT: 'Written off',
  WRITE_OFF_BORROWED: 'Written off',
};
