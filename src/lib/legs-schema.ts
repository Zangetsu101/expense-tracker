// The SQLite schema of the legs model (ADR 0013). A new install runs it, the migration
// runs it, and every later start runs it again. Tables and triggers use IF NOT EXISTS.
// Views are dropped and created again, so that a change to a view reaches old installs.
//
// A Transaction has one or more legs. Each leg moves a signed amount on one Account
// or one Person, in that leg's Currency:
//
//   EXPENSE         one Account leg < 0
//   INCOME          one Account leg > 0
//   TRANSFER        two Account legs: source < 0, destination > 0
//   LENDING         an Account leg and a Person leg with opposite signs
//   WRITE_OFF       one Person leg: LENT < 0, BORROWED > 0
//   REIMBURSEMENT   one Account leg > 0, and a row in reimbursements
//
// A positive Person leg means that the person owes the user more, or the user owes less.
// LENDING and WRITE_OFF also store the Direction (ADR 0003). With the sign of the Account
// leg it gives the old lending kind:
//
//   LENT      Account < 0: LEND     Account > 0: RECEIVE_REPAYMENT   no Account: WRITE_OFF_LENT
//   BORROWED  Account > 0: BORROW   Account < 0: REPAY               no Account: WRITE_OFF_BORROWED

/** PRAGMA user_version of a database with this schema. Version 0 is the old schema. */
export const LEGS_SCHEMA_VERSION = 1;

export const legsSchema = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  currencyCode TEXT NOT NULL,
  openingBalanceMinor INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credit_cards (
  accountId INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  parentAccountId INTEGER REFERENCES accounts(id),
  statementDay INTEGER CHECK(statementDay BETWEEN 1 AND 31),
  dueDay INTEGER CHECK(dueDay BETWEEN 1 AND 31),
  CHECK(accountId != parentAccountId)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('EXPENSE', 'INCOME')),
  parentId INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  iconKey TEXT
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL
    CHECK(kind IN ('EXPENSE', 'INCOME', 'TRANSFER', 'LENDING', 'WRITE_OFF', 'REIMBURSEMENT')),
  direction TEXT CHECK(direction IN ('LENT', 'BORROWED')),
  date INTEGER NOT NULL,
  categoryId INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  note TEXT,
  excludeFromReport INTEGER NOT NULL DEFAULT 0 CHECK(excludeFromReport IN (0, 1)),
  CHECK((kind IN ('LENDING', 'WRITE_OFF')) = (direction IS NOT NULL)),
  CHECK(categoryId IS NULL OR kind IN ('EXPENSE', 'INCOME')),
  CHECK(excludeFromReport = 0 OR kind IN ('EXPENSE', 'INCOME', 'REIMBURSEMENT'))
);
CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date);

CREATE TABLE IF NOT EXISTS legs (
  id INTEGER PRIMARY KEY,
  transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  accountId INTEGER REFERENCES accounts(id),
  personId INTEGER REFERENCES people(id),
  currencyCode TEXT NOT NULL,
  amountMinor INTEGER NOT NULL CHECK(amountMinor <> 0),
  CHECK((accountId IS NULL) <> (personId IS NULL))
);
CREATE INDEX IF NOT EXISTS legs_transaction ON legs(transactionId);
CREATE INDEX IF NOT EXISTS legs_account ON legs(accountId) WHERE accountId IS NOT NULL;
CREATE INDEX IF NOT EXISTS legs_person ON legs(personId) WHERE personId IS NOT NULL;

CREATE TABLE IF NOT EXISTS line_items (
  id INTEGER PRIMARY KEY,
  transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amountMinor INTEGER NOT NULL,
  quantity REAL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transactionId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(transactionId, tagId)
);

CREATE TABLE IF NOT EXISTS split_shares (
  expenseId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  personId INTEGER NOT NULL REFERENCES people(id),
  amountMinor INTEGER NOT NULL CHECK(amountMinor >= 0),
  PRIMARY KEY(expenseId, personId)
);

-- A null personId is a shop refund.
CREATE TABLE IF NOT EXISTS reimbursements (
  transactionId INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  expenseId INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  personId INTEGER,
  FOREIGN KEY(expenseId, personId) REFERENCES split_shares(expenseId, personId) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS reimbursements_expense_person ON reimbursements(expenseId, personId);

-- One row for each setting. Each value is JSON.
-- Portable: favoriteAccountId, displayRate. Device-local: every other key.
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Expo opens a separate connection for exclusive writes, where foreign_keys may be off.
-- These triggers do the work of the foreign key actions on every connection, and they
-- check the rules that span tables.

-- Deletes: cascades and guards.
CREATE TRIGGER IF NOT EXISTS delete_transaction_children AFTER DELETE ON transactions BEGIN
  DELETE FROM reimbursements WHERE transactionId = OLD.id;
  DELETE FROM split_shares WHERE expenseId = OLD.id;
  DELETE FROM legs WHERE transactionId = OLD.id;
  DELETE FROM line_items WHERE transactionId = OLD.id;
  DELETE FROM transaction_tags WHERE transactionId = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS keep_reimbursed_expense BEFORE DELETE ON transactions
  WHEN EXISTS (SELECT 1 FROM reimbursements WHERE expenseId = OLD.id)
  BEGIN SELECT RAISE(ABORT, 'This expense has linked reimbursements. Delete them first.'); END;
CREATE TRIGGER IF NOT EXISTS keep_reimbursed_split_share BEFORE DELETE ON split_shares
  WHEN EXISTS (SELECT 1 FROM reimbursements
    WHERE expenseId = OLD.expenseId AND personId = OLD.personId)
  BEGIN SELECT RAISE(ABORT, 'This share has linked reimbursements. Delete them first.'); END;
CREATE TRIGGER IF NOT EXISTS keep_split_expense_legs BEFORE DELETE ON legs
  WHEN EXISTS (SELECT 1 FROM transactions WHERE id = OLD.transactionId) AND (
    EXISTS (SELECT 1 FROM reimbursements WHERE expenseId = OLD.transactionId)
    OR EXISTS (SELECT 1 FROM split_shares WHERE expenseId = OLD.transactionId))
  BEGIN SELECT RAISE(ABORT, 'Update the legs of a split or reimbursed expense. Do not replace them.'); END;
CREATE TRIGGER IF NOT EXISTS clear_deleted_category AFTER DELETE ON categories BEGIN
  UPDATE categories SET parentId = NULL WHERE parentId = OLD.id;
  UPDATE transactions SET categoryId = NULL WHERE categoryId = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS delete_tag_links AFTER DELETE ON tags BEGIN
  DELETE FROM transaction_tags WHERE tagId = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS keep_used_account BEFORE DELETE ON accounts
  WHEN EXISTS (SELECT 1 FROM legs WHERE accountId = OLD.id)
    OR EXISTS (SELECT 1 FROM credit_cards WHERE parentAccountId = OLD.id)
  BEGIN SELECT RAISE(ABORT, 'This account is still used.'); END;
CREATE TRIGGER IF NOT EXISTS delete_card_settings AFTER DELETE ON accounts BEGIN
  DELETE FROM credit_cards WHERE accountId = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS keep_used_person BEFORE DELETE ON people
  WHEN EXISTS (SELECT 1 FROM legs WHERE personId = OLD.id)
    OR EXISTS (SELECT 1 FROM split_shares WHERE personId = OLD.id)
    OR EXISTS (SELECT 1 FROM reimbursements WHERE personId = OLD.id)
  BEGIN SELECT RAISE(ABORT, 'This person is still used.'); END;

-- Legs: each leg must fit the kind of its Transaction, and an Account leg must use the
-- Currency of its Account. The number of legs is checked by the invariants, because a
-- trigger sees only one row.
CREATE TRIGGER IF NOT EXISTS leg_fits_on_insert BEFORE INSERT ON legs
  WHEN NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = NEW.transactionId AND (
    (t.kind = 'EXPENSE' AND NEW.accountId IS NOT NULL AND NEW.amountMinor < 0) OR
    (t.kind IN ('INCOME', 'REIMBURSEMENT') AND NEW.accountId IS NOT NULL AND NEW.amountMinor > 0) OR
    (t.kind = 'TRANSFER' AND NEW.accountId IS NOT NULL) OR
    t.kind = 'LENDING' OR
    (t.kind = 'WRITE_OFF' AND NEW.personId IS NOT NULL
      AND (NEW.amountMinor < 0) = (t.direction = 'LENT'))))
  OR (NEW.accountId IS NOT NULL
    AND NEW.currencyCode IS NOT (SELECT currencyCode FROM accounts WHERE id = NEW.accountId))
  OR (NEW.personId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.personId))
  BEGIN SELECT RAISE(ABORT, 'This leg does not fit its Transaction or Account.'); END;
CREATE TRIGGER IF NOT EXISTS leg_fits_on_update
  BEFORE UPDATE OF transactionId, accountId, personId, currencyCode, amountMinor ON legs
  WHEN NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = NEW.transactionId AND (
    (t.kind = 'EXPENSE' AND NEW.accountId IS NOT NULL AND NEW.amountMinor < 0) OR
    (t.kind IN ('INCOME', 'REIMBURSEMENT') AND NEW.accountId IS NOT NULL AND NEW.amountMinor > 0) OR
    (t.kind = 'TRANSFER' AND NEW.accountId IS NOT NULL) OR
    t.kind = 'LENDING' OR
    (t.kind = 'WRITE_OFF' AND NEW.personId IS NOT NULL
      AND (NEW.amountMinor < 0) = (t.direction = 'LENT'))))
  OR (NEW.accountId IS NOT NULL
    AND NEW.currencyCode IS NOT (SELECT currencyCode FROM accounts WHERE id = NEW.accountId))
  OR (NEW.personId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.personId))
  BEGIN SELECT RAISE(ABORT, 'This leg does not fit its Transaction or Account.'); END;

-- Split and reimbursed Expenses keep their kind and Currency (ADR 0011).
CREATE TRIGGER IF NOT EXISTS preserve_reimbursement_expense_kind BEFORE UPDATE OF kind ON transactions
  WHEN NEW.kind <> OLD.kind AND (
    EXISTS (SELECT 1 FROM reimbursements WHERE expenseId = OLD.id OR transactionId = OLD.id)
    OR EXISTS (SELECT 1 FROM split_shares WHERE expenseId = OLD.id))
  BEGIN SELECT RAISE(ABORT, 'Cannot change the type or currency of a split or reimbursed expense'); END;
CREATE TRIGGER IF NOT EXISTS preserve_reimbursement_expense_currency
  BEFORE UPDATE OF currencyCode ON legs
  WHEN NEW.currencyCode <> OLD.currencyCode AND (
    EXISTS (SELECT 1 FROM reimbursements
      WHERE expenseId = OLD.transactionId OR transactionId = OLD.transactionId)
    OR EXISTS (SELECT 1 FROM split_shares WHERE expenseId = OLD.transactionId))
  BEGIN SELECT RAISE(ABORT, 'Cannot change the type or currency of a split or reimbursed expense'); END;
CREATE TRIGGER IF NOT EXISTS keep_account_currency BEFORE UPDATE OF currencyCode ON accounts
  WHEN NEW.currencyCode <> OLD.currencyCode
    AND EXISTS (SELECT 1 FROM legs WHERE accountId = OLD.id)
  BEGIN SELECT RAISE(ABORT, 'Currency cannot be changed.'); END;

-- Reimbursements: a REIMBURSEMENT pays back an EXPENSE in the same Currency, not earlier.
CREATE TRIGGER IF NOT EXISTS reimbursement_fits BEFORE INSERT ON reimbursements
  WHEN (SELECT kind FROM transactions WHERE id = NEW.transactionId) IS NOT 'REIMBURSEMENT'
    OR (SELECT kind FROM transactions WHERE id = NEW.expenseId) IS NOT 'EXPENSE'
    OR (SELECT date FROM transactions WHERE id = NEW.transactionId)
      < (SELECT date FROM transactions WHERE id = NEW.expenseId)
    OR (NEW.personId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM split_shares
      WHERE expenseId = NEW.expenseId AND personId = NEW.personId))
  BEGIN SELECT RAISE(ABORT, 'This reimbursement does not fit its expense.'); END;

-- Spending and income for reports. A reimbursement takes the Category of its Expense
-- and lowers spending in the month of its own date (ADR 0011). The columns are the same
-- as before the migration.
DROP VIEW IF EXISTS report_transactions;
CREATE VIEW report_transactions AS
  SELECT t.id, l.accountId, t.date,
    CASE WHEN r.transactionId IS NULL THEN t.categoryId ELSE expense.categoryId END AS categoryId,
    CASE WHEN t.kind IN ('EXPENSE', 'REIMBURSEMENT') THEN -l.amountMinor END AS spendingMinor,
    CASE WHEN t.kind = 'INCOME' THEN l.amountMinor ELSE 0 END AS incomeMinor
  FROM transactions t
  JOIN legs l ON l.transactionId = t.id AND l.accountId IS NOT NULL
  LEFT JOIN reimbursements r ON r.transactionId = t.id
  LEFT JOIN transactions expense ON expense.id = r.expenseId
  WHERE t.kind IN ('EXPENSE', 'INCOME', 'REIMBURSEMENT') AND t.excludeFromReport = 0
    AND (t.kind <> 'REIMBURSEMENT' OR expense.excludeFromReport = 0);

DROP VIEW IF EXISTS split_share_progress;
CREATE VIEW split_share_progress AS
  SELECT expenseId, personId, amountMinor, paidMinor, MAX(0, amountMinor - paidMinor) AS leftMinor
  FROM (SELECT s.*, COALESCE((
    SELECT SUM(l.amountMinor) FROM reimbursements r
    JOIN legs l ON l.transactionId = r.transactionId AND l.accountId IS NOT NULL
    WHERE r.expenseId = s.expenseId AND r.personId = s.personId
  ), 0) AS paidMinor FROM split_shares s);
`;
