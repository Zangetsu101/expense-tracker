import { readBackupV1, type BackupV1 } from './backup-v1.ts';
import { readLegsBackup, type BackupV2, type BackupV3 } from './backup-v2.ts';

type LegsBackup = BackupV2 | BackupV3;
export type Backup = BackupV1 | LegsBackup;

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

/** Throws unless the text is a JSON object whose integers JavaScript can hold exactly. */
function parseJson(json: string): Record<string, unknown> {
  assertRawIntegersSafe(json);
  const raw: unknown = JSON.parse(json);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid backup');
  return raw as Record<string, unknown>;
}

/** Reads a backup file. A v1 file can have references that the restore repairs or reports. */
export function decodeBackup(json: string): Backup {
  const data = parseJson(json);
  return data.schemaVersion === 2 || data.schemaVersion === 3
    ? readLegsBackup(data)
    : readBackupV1(data);
}

/** The text of a backup that stores Legs. Throws if the data is invalid. */
export function encodeBackup(data: LegsBackup): string {
  const json = JSON.stringify(data, null, 2);
  readLegsBackup(parseJson(json));
  return json;
}

/** Storage and database boundaries supplied by the app. Import must replace atomically. */
export interface BackupStore {
  snapshot(): Promise<LegsBackup>;
  replace(data: Backup): Promise<void>;
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
