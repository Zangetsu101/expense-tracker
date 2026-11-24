// The v1 backup that the app writes before the migration to the legs model (ADR 0013).
// The file stays in the document directory until the next successful Drive backup.
import { File, Paths } from 'expo-file-system';

const name = 'expense-backup-before-legs-migration.json';

/** Writes the backup and checks that the whole file is there. Throws if it is not. */
export async function writePreMigrationBackup(json: string) {
  const file = new File(Paths.document, name);
  await file.write(json);
  const bytes = new TextEncoder().encode(json).length;
  if (!file.exists || file.size !== bytes)
    throw new Error('Could not save the backup before the database update.');
}

/** Deletes the backup. Call it only after a successful Drive backup. */
export function removePreMigrationBackup() {
  const file = new File(Paths.document, name);
  if (file.exists) file.delete();
}
