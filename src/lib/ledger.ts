// Types for the legs model (ADR 0013, legs-schema.ts).
//
// There are two levels:
//   - Row types match what SQLite returns. They are loose, like the table.
//   - Transaction is a union with one member for each kind. Each member has only the
//     fields that its kind allows, and Valuation amounts are signed. The member says which
//     way the money moves, and toLegs() gives the signs. So code outside this file
//     cannot write a leg with the wrong sign or the wrong target.
//
// parseTransaction() is the only way from rows to a Transaction. It checks the rules that
// span several rows (the number of legs, their signs and targets), so code that has a
// Transaction can trust its shape.

export type TransactionKind =
  'EXPENSE' | 'INCOME' | 'TRANSFER' | 'LENDING' | 'WRITE_OFF' | 'REIMBURSEMENT' | 'VALUATION';
/** The obligation that a lending movement belongs to (ADR 0003). */
export type Direction = 'LENT' | 'BORROWED';
/** What the user did. Person mode in Quick Add shows these four actions. */
export type LendingAction = 'LEND' | 'RECEIVE_REPAYMENT' | 'BORROW' | 'REPAY';

// ---------------------------------------------------------------------------------------
// Rows

export type TransactionRow = {
  id: number;
  kind: TransactionKind;
  direction: Direction | null;
  date: number;
  categoryId: number | null;
  note: string | null;
  excludeFromReport: 0 | 1;
};

/** A leg moves money on exactly one Account or one Person. */
export type LegRow = {
  transactionId: number;
  currencyCode: string;
  /** Signed. Positive adds to the Account, or to what the person owes the user. */
  amountMinor: number;
} & ({ accountId: number; personId: null } | { accountId: null; personId: number });

export type ReimbursementRow = {
  transactionId: number;
  expenseId: number;
  /** Null for a shop refund. */
  personId: number | null;
};

// ---------------------------------------------------------------------------------------
// Transactions. Each amountMinor is positive except for the signed amount of a Valuation.

type Common = {
  id: number;
  /** Local epoch day. */
  date: number;
  note: string | null;
};

/** Expenses and Income have a Category and can be left out of reports. */
type Categorized = {
  accountId: number;
  amountMinor: number;
  categoryId: number | null;
  excludeFromReport: boolean;
};

/** Money that left an Account. */
export type Expense = Common & Categorized & { kind: 'EXPENSE' };

/** Money that came into an Account. */
export type Income = Common & Categorized & { kind: 'INCOME' };

/** Money between two of the user's Accounts. Each side uses its own Account's Currency. */
export type Transfer = Common & {
  kind: 'TRANSFER';
  from: { accountId: number; amountMinor: number };
  to: { accountId: number; amountMinor: number };
};

/** Principal that moves between an Account and a person. */
export type Lending = Common & {
  kind: 'LENDING';
  action: LendingAction;
  accountId: number;
  personId: number;
  amountMinor: number;
};

/** An obligation that is cancelled without money. It has no Account. */
export type WriteOff = Common & {
  kind: 'WRITE_OFF';
  direction: Direction;
  personId: number;
  currencyCode: string;
  amountMinor: number;
};

/** Money that pays back an Expense. It lowers the Expense's Category (ADR 0011). */
export type Reimbursement = Common & {
  kind: 'REIMBURSEMENT';
  accountId: number;
  amountMinor: number;
  excludeFromReport: boolean;
  expenseId: number;
  /** Null for a shop refund. Otherwise the person of a split share of the Expense. */
  personId: number | null;
};

/** A signed change in the value of an Investment. */
export type Valuation = Common & { kind: 'VALUATION'; accountId: number; amountMinor: number };

export type Transaction =
  Expense | Income | Transfer | Lending | WriteOff | Reimbursement | Valuation;

/** A Transaction before it is saved. */
export type NewTransaction = Transaction extends infer T
  ? T extends Transaction
    ? Omit<T, 'id'>
    : never
  : never;

/** A leg before it is saved. */
export type NewLeg = Omit<LegRow, 'transactionId'>;

// ---------------------------------------------------------------------------------------
// The lending action, and the Direction and the sign of the Account leg

const lendingActions = {
  LEND: { direction: 'LENT', accountSign: -1 },
  RECEIVE_REPAYMENT: { direction: 'LENT', accountSign: 1 },
  BORROW: { direction: 'BORROWED', accountSign: 1 },
  REPAY: { direction: 'BORROWED', accountSign: -1 },
} as const satisfies Record<LendingAction, { direction: Direction; accountSign: 1 | -1 }>;

export function directionOf(action: LendingAction): Direction {
  return lendingActions[action].direction;
}

function lendingAction(direction: Direction, accountAmount: number): LendingAction {
  if (direction === 'LENT') return accountAmount < 0 ? 'LEND' : 'RECEIVE_REPAYMENT';
  return accountAmount > 0 ? 'BORROW' : 'REPAY';
}

// ---------------------------------------------------------------------------------------
// From a Transaction to its legs

/** The signed legs of a Transaction. `currencyOf` gives each Account's Currency. */
export function toLegs(
  transaction: Transaction | NewTransaction,
  currencyOf: (accountId: number) => string,
): NewLeg[] {
  const account = (accountId: number, amountMinor: number): NewLeg => ({
    accountId,
    personId: null,
    currencyCode: currencyOf(accountId),
    amountMinor,
  });
  const person = (personId: number, currencyCode: string, amountMinor: number): NewLeg => ({
    accountId: null,
    personId,
    currencyCode,
    amountMinor,
  });
  switch (transaction.kind) {
    case 'EXPENSE':
      return [account(transaction.accountId, -transaction.amountMinor)];
    case 'VALUATION':
    case 'INCOME':
    case 'REIMBURSEMENT':
      return [account(transaction.accountId, transaction.amountMinor)];
    case 'TRANSFER':
      return [
        account(transaction.from.accountId, -transaction.from.amountMinor),
        account(transaction.to.accountId, transaction.to.amountMinor),
      ];
    case 'LENDING': {
      const signed = lendingActions[transaction.action].accountSign * transaction.amountMinor;
      return [
        account(transaction.accountId, signed),
        person(transaction.personId, currencyOf(transaction.accountId), -signed),
      ];
    }
    case 'WRITE_OFF':
      return [
        person(
          transaction.personId,
          transaction.currencyCode,
          transaction.direction === 'LENT' ? -transaction.amountMinor : transaction.amountMinor,
        ),
      ];
  }
}

// ---------------------------------------------------------------------------------------
// From rows to a Transaction

export class LedgerShapeError extends Error {
  constructor(id: number, problem: string) {
    super(`Transaction ${id} ${problem}`);
    this.name = 'LedgerShapeError';
  }
}

type AccountLeg = Extract<LegRow, { personId: null }>;
type PersonLeg = Extract<LegRow, { accountId: null }>;

/**
 * Builds a Transaction from its rows. Throws LedgerShapeError if the rows break a rule
 * of the legs model. `reimbursement` is the row in reimbursements, if there is one.
 */
export function parseTransaction(
  row: TransactionRow,
  legs: LegRow[],
  reimbursement?: ReimbursementRow,
): Transaction {
  const fail = (problem: string): never => {
    throw new LedgerShapeError(row.id, problem);
  };
  const accounts = legs.filter((leg): leg is AccountLeg => leg.accountId !== null);
  const people = legs.filter((leg): leg is PersonLeg => leg.personId !== null);
  const shape = (accountLegs: number, personLegs: number) => {
    if (accounts.length !== accountLegs || people.length !== personLegs)
      fail(`(${row.kind}) has ${accounts.length} Account and ${people.length} Person legs`);
  };
  const common: Common = { id: row.id, date: row.date, note: row.note };
  if ((row.kind === 'REIMBURSEMENT') !== (reimbursement !== undefined))
    fail('has a reimbursement row that does not match its kind');
  if ((row.kind === 'LENDING' || row.kind === 'WRITE_OFF') !== (row.direction !== null))
    fail('has a direction that does not match its kind');
  if (row.categoryId !== null && row.kind !== 'EXPENSE' && row.kind !== 'INCOME')
    fail(`(${row.kind}) has a Category`);

  switch (row.kind) {
    case 'EXPENSE':
    case 'INCOME': {
      shape(1, 0);
      const [leg] = accounts;
      if (row.kind === 'EXPENSE' ? leg.amountMinor >= 0 : leg.amountMinor <= 0)
        fail(`(${row.kind}) has a leg with the wrong sign`);
      return {
        ...common,
        kind: row.kind,
        accountId: leg.accountId,
        amountMinor: Math.abs(leg.amountMinor),
        categoryId: row.categoryId,
        excludeFromReport: row.excludeFromReport === 1,
      };
    }
    case 'VALUATION': {
      shape(1, 0);
      const [leg] = accounts;
      if (leg.amountMinor === 0) fail('(VALUATION) has a zero amount');
      return { ...common, kind: row.kind, accountId: leg.accountId, amountMinor: leg.amountMinor };
    }
    case 'TRANSFER': {
      shape(2, 0);
      const from = accounts.find((leg) => leg.amountMinor < 0);
      const to = accounts.find((leg) => leg.amountMinor > 0);
      if (!from || !to || from.accountId === to.accountId)
        return fail('(TRANSFER) needs one source and one destination Account');
      if (from.currencyCode === to.currencyCode && from.amountMinor !== -to.amountMinor)
        fail('(TRANSFER) moves different amounts in one Currency');
      return {
        ...common,
        kind: 'TRANSFER',
        from: { accountId: from.accountId, amountMinor: -from.amountMinor },
        to: { accountId: to.accountId, amountMinor: to.amountMinor },
      };
    }
    case 'LENDING': {
      shape(1, 1);
      const [account] = accounts;
      const [person] = people;
      if (
        account.amountMinor !== -person.amountMinor ||
        account.currencyCode !== person.currencyCode
      )
        fail('(LENDING) has legs that do not balance');
      return {
        ...common,
        kind: 'LENDING',
        action: lendingAction(row.direction!, account.amountMinor),
        accountId: account.accountId,
        personId: person.personId,
        amountMinor: Math.abs(account.amountMinor),
      };
    }
    case 'WRITE_OFF': {
      shape(0, 1);
      const [person] = people;
      if (person.amountMinor < 0 !== (row.direction === 'LENT'))
        fail('(WRITE_OFF) has a leg with the wrong sign');
      return {
        ...common,
        kind: 'WRITE_OFF',
        direction: row.direction!,
        personId: person.personId,
        currencyCode: person.currencyCode,
        amountMinor: Math.abs(person.amountMinor),
      };
    }
    case 'REIMBURSEMENT': {
      shape(1, 0);
      const [leg] = accounts;
      if (leg.amountMinor <= 0) fail('(REIMBURSEMENT) has a leg with the wrong sign');
      return {
        ...common,
        kind: 'REIMBURSEMENT',
        accountId: leg.accountId,
        amountMinor: leg.amountMinor,
        excludeFromReport: row.excludeFromReport === 1,
        expenseId: reimbursement!.expenseId,
        personId: reimbursement!.personId,
      };
    }
  }
}

function transactionDirection(transaction: NewTransaction): Direction | null {
  if (transaction.kind === 'LENDING') return directionOf(transaction.action);
  if (transaction.kind === 'WRITE_OFF') return transaction.direction;
  return null;
}

/** The columns of a transactions row for a Transaction. */
export function toTransactionRow(transaction: NewTransaction): Omit<TransactionRow, 'id'> {
  const reportable =
    transaction.kind === 'EXPENSE' ||
    transaction.kind === 'INCOME' ||
    transaction.kind === 'REIMBURSEMENT';
  return {
    kind: transaction.kind,
    direction: transactionDirection(transaction),
    date: transaction.date,
    categoryId:
      transaction.kind === 'EXPENSE' || transaction.kind === 'INCOME'
        ? transaction.categoryId
        : null,
    note: transaction.note,
    excludeFromReport: reportable && transaction.excludeFromReport ? 1 : 0,
  };
}
