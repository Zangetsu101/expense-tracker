// Native Android backup schema v1 (BackupModels.kt). Long values are JSON numbers;
// JavaScript cannot preserve integers outside Number.MAX_SAFE_INTEGER.
export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupData {
  schemaVersion: number;
  accounts: {
    id: number;
    name: string;
    currencyCode: string;
    openingBalanceMinor: number;
    isFavorite: boolean;
  }[];
  categories: {
    id: number;
    name: string;
    type: string;
    parentId: number | null;
    iconKey: string | null;
    needsReview: boolean;
  }[];
  transactions: {
    id: number;
    type: string;
    receivedAmountMinor?: number | null;
    amountMinor: number;
    dateEpochDay: number;
    accountId: number;
    transferAccountId: number | null;
    categoryId: number | null;
    note: string | null;
    excludeFromReport: boolean;
    source: string;
  }[];
  lineItems: {
    id: number;
    transactionId: number;
    name: string;
    amountMinor: number;
    quantity: number | null;
  }[];
  tags: { id: number; name: string }[];
  transactionTags: { transactionId: number; tagId: number }[];
  transferCandidates: {
    id: number;
    outgoingTxnId: number;
    incomingTxnId: number;
    confidenceNote: string;
    resolved: boolean;
  }[];
  settings: {
    favoriteAccountId: number | null;
    displayRate: { base: string; quote: string; rate: number } | null;
  };
  /** Expo extension to native v1; absent from backups written by the native app. */
  moneyLoverImportRows?: { rowKey: string; transactionId: number }[];
  creditCards?: {
    accountId: number;
    parentAccountId: number | null;
    statementDay: number | null;
    dueDay: number | null;
  }[];
  people?: { id: number; name: string }[];
  splitShares?: { expenseId: number; personId: number; amountMinor: number }[];
  reimbursements?: { transactionId: number; expenseId: number; personId: number | null }[];
  lendingEntries?: {
    id: number;
    personId: number;
    kind: string;
    transactionId: number | null;
    currencyCode: string;
    amountMinor: number;
    dateEpochDay: number;
    note: string | null;
  }[];
}

const arrays = [
  'accounts',
  'categories',
  'transactions',
  'lineItems',
  'tags',
  'transactionTags',
  'transferCandidates',
] as const;
const longFields = [
  'id',
  'openingBalanceMinor',
  'parentId',
  'amountMinor',
  'receivedAmountMinor',
  'dateEpochDay',
  'accountId',
  'transferAccountId',
  'categoryId',
  'transactionId',
  'tagId',
  'expenseId',
  'personId',
  'outgoingTxnId',
  'incomingTxnId',
  'favoriteAccountId',
] as const;

/** Reject unsafe Longs rather than silently corrupting IDs or minor-unit amounts. */
function assertSafeLongs(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertSafeLongs);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (
        longFields.includes(key as (typeof longFields)[number]) &&
        item != null &&
        (typeof item !== 'number' || !Number.isSafeInteger(item))
      ) {
        throw new Error(`Backup field ${key} is not a safe integer`);
      }
      assertSafeLongs(item);
    }
  }
}

// Scan numeric tokens before JSON.parse rounds large integers. Fractional display rates
// are permitted; all bare integers must fit in JavaScript's exact integer range.
function assertRawIntegersSafe(json: string): void {
  const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let inString = false;
  for (let index = 0; index < json.length; index++) {
    const char = json[index];
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      if (char === '\\') index++;
      continue;
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      numberToken.lastIndex = index;
      const match = numberToken.exec(json);
      if (!match) continue;
      const token = match[0];
      if (!/[.eE]/.test(token) && !Number.isSafeInteger(Number(token))) {
        throw new Error('Backup contains an integer too large for JavaScript');
      }
      index += token.length - 1;
    }
  }
}

/**
 * How to treat a row that points to a row that is not in the backup.
 *
 * - `repair`: accept it. The old app deleted on a connection with foreign keys off, so a
 *   backup can keep rows of a deleted Transaction. The restore cleans them, as the old
 *   foreign key actions would have done. The restore also names each missing Account or
 *   person that a Leg or a split share needs, and stops.
 * - `strict`: refuse it. Use this mode for a backup that the app writes, and for the rows
 *   that a restore has cleaned.
 */
type References = 'repair' | 'strict';

/** Reads a backup file. It accepts references that the restore repairs or reports. */
export function decodeBackup(json: string): BackupData {
  return parseBackup(json, 'repair');
}

/** Throws if the cleaned rows of a restore are not a valid backup. */
export function assertCleanBackup(data: BackupData): void {
  parseBackup(JSON.stringify(data), 'strict');
}

function parseBackup(json: string, references: References): BackupData {
  const strict = references === 'strict';
  assertRawIntegersSafe(json);
  const raw: unknown = JSON.parse(json);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid backup');
  const data = raw as Record<string, unknown>;
  if (
    !Number.isInteger(data.schemaVersion) ||
    (data.schemaVersion as number) < 1 ||
    (data.schemaVersion as number) > BACKUP_SCHEMA_VERSION
  )
    throw new Error('Unsupported backup schema version');
  for (const key of arrays) {
    if (data[key] !== undefined && !Array.isArray(data[key]))
      throw new Error(`Invalid backup ${key}`);
  }
  if (
    data.settings !== undefined &&
    (data.settings === null || typeof data.settings !== 'object' || Array.isArray(data.settings))
  ) {
    throw new Error('Invalid backup settings');
  }
  assertSafeLongs(data);
  if (data.moneyLoverImportRows !== undefined) {
    if (!Array.isArray(data.moneyLoverImportRows))
      throw new Error('Invalid backup moneyLoverImportRows');
    const keys = new Set<string>();
    const transactionIds = new Set(
      ((data.transactions ?? []) as { id: number }[]).map((row) => row.id),
    );
    for (const row of data.moneyLoverImportRows) {
      if (
        row === null ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        typeof row.rowKey !== 'string' ||
        !row.rowKey ||
        !Number.isSafeInteger(row.transactionId) ||
        (strict && !transactionIds.has(row.transactionId)) ||
        keys.has(row.rowKey)
      ) {
        throw new Error('Invalid backup moneyLoverImportRows');
      }
      keys.add(row.rowKey);
    }
  }
  validateTransactionAccounts(data, strict);
  validateCreditCards(data, strict);
  validateLending(data, strict);
  validateReimbursements(data, strict);
  const settings = (data.settings ?? {}) as BackupData['settings'];
  return {
    schemaVersion: data.schemaVersion as number,
    accounts: (data.accounts ?? []) as BackupData['accounts'],
    categories: (data.categories ?? []) as BackupData['categories'],
    transactions: (data.transactions ?? []) as BackupData['transactions'],
    lineItems: (data.lineItems ?? []) as BackupData['lineItems'],
    tags: (data.tags ?? []) as BackupData['tags'],
    transactionTags: (data.transactionTags ?? []) as BackupData['transactionTags'],
    transferCandidates: (data.transferCandidates ?? []) as BackupData['transferCandidates'],
    settings: {
      favoriteAccountId: settings.favoriteAccountId ?? null,
      displayRate: settings.displayRate ?? null,
    },
    ...(data.creditCards !== undefined
      ? { creditCards: data.creditCards as BackupData['creditCards'] }
      : {}),
    ...(data.splitShares !== undefined
      ? { splitShares: data.splitShares as BackupData['splitShares'] }
      : {}),
    ...(data.reimbursements !== undefined
      ? { reimbursements: data.reimbursements as BackupData['reimbursements'] }
      : {}),
    ...(data.people !== undefined ? { people: data.people as BackupData['people'] } : {}),
    ...(data.lendingEntries !== undefined
      ? { lendingEntries: data.lendingEntries as BackupData['lendingEntries'] }
      : {}),
    ...(data.moneyLoverImportRows !== undefined
      ? { moneyLoverImportRows: data.moneyLoverImportRows as BackupData['moneyLoverImportRows'] }
      : {}),
  };
}

/**
 * Checks the Accounts of each Transaction and the received amount of a Transfer.
 *
 * In the strict mode each Transaction needs its source Account, and each Transfer needs its
 * destination Account. In the repair mode a missing Account passes, because the restore
 * names it and stops. A received amount on a row that is not a Transfer also passes,
 * because the restore clears it.
 */
function validateTransactionAccounts(data: Record<string, unknown>, strict: boolean): void {
  const currencies = new Map(
    ((data.accounts ?? []) as BackupData['accounts']).map((row) => [row.id, row.currencyCode]),
  );
  for (const row of (data.transactions ?? []) as BackupData['transactions']) {
    const source = currencies.get(row.accountId);
    const destination = currencies.get(row.transferAccountId!);
    const transfer = row.type === 'TRANSFER';
    if (strict && (!source || (transfer && !destination)))
      throw new Error('Invalid backup Transaction Account');
    if (row.receivedAmountMinor == null) continue;
    if (row.receivedAmountMinor <= 0 || (strict && !transfer))
      throw new Error('Invalid backup amount received');
    if (transfer && source && destination && source === destination)
      throw new Error('Invalid backup amount received');
  }
}

function validateCreditCards(data: Record<string, unknown>, strict: boolean): void {
  if (data.creditCards === undefined) return;
  if (!Array.isArray(data.creditCards)) throw new Error('Invalid backup credit cards');
  const cards = data.creditCards as NonNullable<BackupData['creditCards']>;
  const accounts = (data.accounts ?? []) as BackupData['accounts'];
  const ids = new Set<number>();
  for (const card of cards) {
    if (
      !card ||
      !Number.isSafeInteger(card.accountId) ||
      (strict && !accounts.some((a) => a.id === card.accountId)) ||
      ids.has(card.accountId) ||
      [card.statementDay, card.dueDay].some(
        (day) => day !== null && (!Number.isInteger(day) || day < 1 || day > 31),
      )
    )
      throw new Error('Invalid backup credit cards');
    ids.add(card.accountId);
  }
  for (const card of cards) {
    if (card.parentAccountId === null) continue;
    const parent = accounts.find((a) => a.id === card.parentAccountId);
    if ((strict && !parent) || (parent && ids.has(parent.id)))
      throw new Error('Invalid backup credit-card parent');
  }
}

function validateLending(data: Record<string, unknown>, strict: boolean): void {
  const fail = (): never => {
    throw new Error('Invalid backup lending metadata');
  };
  const record = (row: unknown): row is Record<string, unknown> =>
    row !== null && typeof row === 'object' && !Array.isArray(row);
  const id = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) > 0;
  const people = data.people ?? [];
  const entries = data.lendingEntries ?? [];
  if (
    (data.people !== undefined && !Array.isArray(data.people)) ||
    (data.lendingEntries !== undefined && !Array.isArray(data.lendingEntries))
  )
    fail();
  const personIds = new Set<number>();
  const names = new Set<string>();
  for (const person of people as unknown[]) {
    if (!record(person) || !id(person.id) || typeof person.name !== 'string' || !person.name.trim())
      fail();
    const row = person as { id: number; name: string };
    // Match SQLite's NOCASE uniqueness (ASCII folding only).
    const name = row.name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    if (personIds.has(row.id) || names.has(name)) fail();
    personIds.add(row.id);
    names.add(name);
  }
  const ids = new Set<number>();
  const linked = new Set<number>();
  const transactions = (data.transactions ?? []) as BackupData['transactions'];
  const accounts = (data.accounts ?? []) as BackupData['accounts'];
  for (const entry of entries as unknown[]) {
    if (
      !record(entry) ||
      !id(entry.id) ||
      !id(entry.personId) ||
      (strict && !personIds.has(entry.personId)) ||
      typeof entry.kind !== 'string' ||
      ![
        'LEND',
        'BORROW',
        'RECEIVE_REPAYMENT',
        'REPAY',
        'WRITE_OFF_LENT',
        'WRITE_OFF_BORROWED',
      ].includes(entry.kind) ||
      !id(entry.amountMinor) ||
      !Number.isSafeInteger(entry.dateEpochDay) ||
      typeof entry.currencyCode !== 'string' ||
      !/^[A-Z]{3}$/.test(entry.currencyCode) ||
      !(entry.note === null || typeof entry.note === 'string')
    )
      fail();
    const row = entry as NonNullable<BackupData['lendingEntries']>[number];
    if (ids.has(row.id)) fail();
    ids.add(row.id);
    if (row.kind.startsWith('WRITE_OFF_')) {
      if (row.transactionId !== null) fail();
    } else {
      if (!id(row.transactionId) || linked.has(row.transactionId)) fail();
      linked.add(row.transactionId!);
      const transaction = transactions.find((item) => item?.id === row.transactionId);
      if (!transaction) {
        if (strict) fail();
        continue;
      }
      const account = accounts.find((item) => item?.id === transaction.accountId);
      if (
        (strict && !account) ||
        (account && account.currencyCode !== row.currencyCode) ||
        transaction.type !== (row.kind === 'LEND' || row.kind === 'REPAY' ? 'EXPENSE' : 'INCOME') ||
        !transaction.excludeFromReport ||
        transaction.amountMinor !== row.amountMinor ||
        transaction.dateEpochDay !== row.dateEpochDay ||
        transaction.note !== row.note ||
        transaction.transferAccountId !== null
      )
        fail();
    }
  }
}

function validateReimbursements(data: Record<string, unknown>, strict: boolean) {
  const { splitShares = [], reimbursements = [] } = data;
  if (!Array.isArray(splitShares) || !Array.isArray(reimbursements))
    throw new Error('Invalid backup split or reimbursement metadata');
  if (!splitShares.length && !reimbursements.length) return;
  const transactions = new Map(
    ((data.transactions ?? []) as BackupData['transactions']).map((row) => [row.id, row]),
  );
  const currencies = new Map(
    ((data.accounts ?? []) as BackupData['accounts']).map((row) => [row.id, row.currencyCode]),
  );
  const people = new Set(
    ((data.people ?? []) as NonNullable<BackupData['people']>).map((p) => p.id),
  );
  const shares = new Set<string>();
  for (const row of splitShares) {
    const key = `${row?.expenseId}:${row?.personId}`;
    const expense = transactions.get(row?.expenseId);
    if (
      !row ||
      (expense ? expense.type !== 'EXPENSE' : strict) ||
      (strict && !people.has(row.personId)) ||
      !Number.isSafeInteger(row.amountMinor) ||
      row.amountMinor < 0 ||
      shares.has(key)
    )
      throw new Error('Invalid backup split share');
    shares.add(key);
  }
  const payments = new Set<number>();
  for (const row of reimbursements) {
    const expense = transactions.get(row?.expenseId);
    const payment = transactions.get(row?.transactionId);
    const fail = () => {
      throw new Error('Invalid backup reimbursement link');
    };
    // A shop refund has an explicit null person. A missing key is not a refund.
    if (
      !row ||
      typeof row !== 'object' ||
      (row.personId !== null && !(Number.isSafeInteger(row.personId) && row.personId > 0)) ||
      payments.has(row.transactionId)
    )
      fail();
    payments.add(row.transactionId);
    const missingShare = row.personId !== null && !shares.has(`${row.expenseId}:${row.personId}`);
    // The restore deletes a reimbursement of a missing Transaction or a missing split share.
    if (!expense || !payment || missingShare) {
      if (strict) fail();
      continue;
    }
    const [expenseCurrency, paymentCurrency] = [
      currencies.get(expense.accountId),
      currencies.get(payment.accountId),
    ];
    if (
      expense.type !== 'EXPENSE' ||
      payment.type !== 'INCOME' ||
      payment.dateEpochDay < expense.dateEpochDay ||
      (strict && (!expenseCurrency || !paymentCurrency)) ||
      (expenseCurrency && paymentCurrency && expenseCurrency !== paymentCurrency)
    )
      fail();
  }
}

export function encodeBackup(data: BackupData): string {
  if (data.schemaVersion !== BACKUP_SCHEMA_VERSION)
    throw new Error('Unsupported backup schema version');
  assertSafeLongs(data);
  const json = JSON.stringify(data, null, 2);
  parseBackup(json, 'strict');
  return json;
}

/** Storage and database boundaries supplied by the app. Import must replace atomically. */
export interface BackupStore {
  snapshot(): Promise<BackupData>;
  replace(data: BackupData): Promise<void>;
}

/** Share sheet and document picker boundary: URIs come from the system, never a raw path. */
export interface BackupDocuments {
  /** Writes the text to a temporary file and opens the share sheet. */
  shareJson(name: string, text: string): Promise<void>;
  pickJsonDocument(): Promise<{ uri: string; name: string } | null>;
  readText(uri: string): Promise<string>;
}

let pendingBackupOperation: Promise<unknown> = Promise.resolve();
export function serializeBackupOperation<T>(job: () => Promise<T>): Promise<T> {
  const result = pendingBackupOperation.then(job);
  pendingBackupOperation = result.catch(() => {});
  return result;
}

export async function shareBackup(
  store: BackupStore,
  documents: Pick<BackupDocuments, 'shareJson'>,
  now = new Date(),
): Promise<void> {
  const json = await serializeBackupOperation(async () => encodeBackup(await store.snapshot()));
  await documents.shareJson(`expense-backup-${now.toISOString().slice(0, 10)}.json`, json);
}

export async function restoreBackup(
  store: BackupStore,
  documents: Pick<BackupDocuments, 'pickJsonDocument' | 'readText'>,
  confirm: (name: string) => Promise<boolean>,
): Promise<boolean> {
  return serializeBackupOperation(async () => {
    const document = await documents.pickJsonDocument();
    if (document === null) return false;
    const data = decodeBackup(await documents.readText(document.uri));
    if (!(await confirm(document.name))) return false;
    await store.replace(data);
    return true;
  });
}
