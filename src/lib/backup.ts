// Native Android backup schema v1 (BackupModels.kt). Long values are JSON numbers;
// JavaScript cannot preserve integers outside Number.MAX_SAFE_INTEGER.
export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupData {
  schemaVersion: number;
  accounts: { id: number; name: string; currencyCode: string; openingBalanceMinor: number; isFavorite: boolean }[];
  categories: { id: number; name: string; type: string; parentId: number | null; iconKey: string | null; needsReview: boolean }[];
  transactions: { id: number; type: string; amountMinor: number; dateEpochDay: number; accountId: number; transferAccountId: number | null; categoryId: number | null; note: string | null; excludeFromReport: boolean; source: string }[];
  lineItems: { id: number; transactionId: number; name: string; amountMinor: number; quantity: number | null }[];
  tags: { id: number; name: string }[];
  transactionTags: { transactionId: number; tagId: number }[];
  transferCandidates: { id: number; outgoingTxnId: number; incomingTxnId: number; confidenceNote: string; resolved: boolean }[];
  settings: { favoriteAccountId: number | null; displayRate: { base: string; quote: string; rate: number } | null };
  /** Expo extension to native v1; absent from backups written by the native app. */
  moneyLoverImportRows?: { rowKey: string; transactionId: number }[];
  people?: { id: number; name: string }[];
  lendingEntries?: { id: number; personId: number; kind: string; transactionId: number | null; currencyCode: string; amountMinor: number; dateEpochDay: number; note: string | null }[];
}

const arrays = ['accounts', 'categories', 'transactions', 'lineItems', 'tags', 'transactionTags', 'transferCandidates'] as const;
const longFields = ['id', 'openingBalanceMinor', 'parentId', 'amountMinor', 'dateEpochDay', 'accountId', 'transferAccountId', 'categoryId', 'transactionId', 'tagId', 'outgoingTxnId', 'incomingTxnId', 'favoriteAccountId'] as const;

/** Reject unsafe Longs rather than silently corrupting IDs or minor-unit amounts. */
function assertSafeLongs(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertSafeLongs);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (longFields.includes(key as typeof longFields[number]) && item != null &&
          (typeof item !== 'number' || !Number.isSafeInteger(item))) {
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

export function decodeBackup(json: string): BackupData {
  assertRawIntegersSafe(json);
  const raw: unknown = JSON.parse(json);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid backup');
  const data = raw as Record<string, unknown>;
  if (!Number.isInteger(data.schemaVersion) || (data.schemaVersion as number) < 1 ||
      (data.schemaVersion as number) > BACKUP_SCHEMA_VERSION) throw new Error('Unsupported backup schema version');
  for (const key of arrays) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`Invalid backup ${key}`);
  }
  if (data.settings !== undefined && (data.settings === null || typeof data.settings !== 'object' || Array.isArray(data.settings))) {
    throw new Error('Invalid backup settings');
  }
  assertSafeLongs(data);
  if (data.moneyLoverImportRows !== undefined) {
    if (!Array.isArray(data.moneyLoverImportRows)) throw new Error('Invalid backup moneyLoverImportRows');
    const keys = new Set<string>();
    const transactionIds = new Set(((data.transactions ?? []) as { id: number }[]).map((row) => row.id));
    for (const row of data.moneyLoverImportRows) {
      if (row === null || typeof row !== 'object' || Array.isArray(row) ||
          typeof row.rowKey !== 'string' || !row.rowKey ||
          !Number.isSafeInteger(row.transactionId) || !transactionIds.has(row.transactionId) || keys.has(row.rowKey)) {
        throw new Error('Invalid backup moneyLoverImportRows');
      }
      keys.add(row.rowKey);
    }
  }
  validateLending(data);
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
    settings: { favoriteAccountId: settings.favoriteAccountId ?? null, displayRate: settings.displayRate ?? null },
    ...(data.people !== undefined ? { people: data.people as BackupData['people'] } : {}),
    ...(data.lendingEntries !== undefined ? { lendingEntries: data.lendingEntries as BackupData['lendingEntries'] } : {}),
    ...(data.moneyLoverImportRows !== undefined ? { moneyLoverImportRows: data.moneyLoverImportRows as BackupData['moneyLoverImportRows'] } : {}),
  };
}

function validateLending(data: Record<string, unknown>): void {
  const fail = (): never => { throw new Error('Invalid backup lending metadata'); };
  const record = (row: unknown): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row);
  const id = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
  const people = data.people ?? [];
  const entries = data.lendingEntries ?? [];
  if ((data.people !== undefined && !Array.isArray(data.people)) ||
      (data.lendingEntries !== undefined && !Array.isArray(data.lendingEntries))) fail();
  const personIds = new Set<number>();
  const names = new Set<string>();
  for (const person of people as unknown[]) {
    if (!record(person) || !id(person.id) || typeof person.name !== 'string' || !person.name.trim()) fail();
    const row = person as { id: number; name: string };
    // Match SQLite's NOCASE uniqueness (ASCII folding only).
    const name = row.name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    if (personIds.has(row.id) || names.has(name)) fail();
    personIds.add(row.id); names.add(name);
  }
  const ids = new Set<number>();
  const linked = new Set<number>();
  const transactions = (data.transactions ?? []) as BackupData['transactions'];
  const accounts = (data.accounts ?? []) as BackupData['accounts'];
  for (const entry of entries as unknown[]) {
    if (!record(entry) || !id(entry.id) || !id(entry.personId) || !personIds.has(entry.personId) ||
        typeof entry.kind !== 'string' || !['LEND', 'BORROW', 'RECEIVE_REPAYMENT', 'REPAY', 'WRITE_OFF_LENT', 'WRITE_OFF_BORROWED'].includes(entry.kind) ||
        !id(entry.amountMinor) || !Number.isSafeInteger(entry.dateEpochDay) ||
        typeof entry.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(entry.currencyCode) ||
        !(entry.note === null || typeof entry.note === 'string')) fail();
    const row = entry as NonNullable<BackupData['lendingEntries']>[number];
    if (ids.has(row.id)) fail();
    ids.add(row.id);
    if (row.kind.startsWith('WRITE_OFF_')) {
      if (row.transactionId !== null) fail();
    } else {
      if (!id(row.transactionId) || linked.has(row.transactionId)) fail();
      const transaction = transactions.find((item) => item?.id === row.transactionId);
      const account = accounts.find((item) => item?.id === transaction?.accountId);
      if (!transaction || !account || account.currencyCode !== row.currencyCode ||
          transaction.type !== (row.kind === 'LEND' || row.kind === 'REPAY' ? 'EXPENSE' : 'INCOME') ||
          !transaction.excludeFromReport || transaction.amountMinor !== row.amountMinor ||
          transaction.dateEpochDay !== row.dateEpochDay || transaction.note !== row.note ||
          transaction.transferAccountId !== null) fail();
      linked.add(row.transactionId!);
    }
  }
}

export function encodeBackup(data: BackupData): string {
  if (data.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error('Unsupported backup schema version');
  assertSafeLongs(data);
  const json = JSON.stringify(data, null, 2);
  decodeBackup(json);
  return json;
}

/** Storage and database boundaries supplied by the app. Import must replace atomically. */
export interface BackupStore {
  snapshot(): Promise<BackupData>;
  replace(data: BackupData): Promise<void>;
}

/** Android document picker / SAF boundary: URI is selected by the user, never a raw filesystem path. */
export interface BackupDocuments {
  createJsonDocument(name: string): Promise<string | null>;
  pickJsonDocument(): Promise<string | null>;
  writeText(uri: string, text: string): Promise<void>;
  readText(uri: string): Promise<string>;
}

export async function exportBackup(store: BackupStore, documents: BackupDocuments, name = 'expense-backup.json'): Promise<string | null> {
  const json = encodeBackup(await store.snapshot());
  const uri = await documents.createJsonDocument(name);
  if (uri !== null) await documents.writeText(uri, json);
  return uri;
}

export async function restoreBackup(store: BackupStore, documents: BackupDocuments): Promise<boolean> {
  const uri = await documents.pickJsonDocument();
  if (uri === null) return false;
  const data = decodeBackup(await documents.readText(uri));
  await store.replace(data);
  return true;
}
