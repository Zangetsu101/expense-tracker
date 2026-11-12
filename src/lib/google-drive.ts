import { DriveError, type DriveFolder } from '@/lib/drive-backups';

type FetchResponse = { ok: boolean; status: number; text(): Promise<string> };
type Fetch = (
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

export interface GoogleDriveOptions {
  /** Returns an OAuth access token with the `drive.file` scope. */
  accessToken(): Promise<string>;
  /** Forgets a token that Drive refused, so that the next call gets a new one. */
  invalidate(token: string): Promise<void>;
  fetch: Fetch;
  baseUrl?: string;
}

const folderName = 'Expense Tracker Backups';
const folderMime = 'application/vnd.google-apps.folder';
const marker = "appProperties has { key='expenseTracker' and value='backups' }";

/** Drive REST v3 client. With `drive.file`, Drive shows only the files that this app made. */
export function createGoogleDrive(options: GoogleDriveOptions): DriveFolder {
  const base = options.baseUrl ?? 'https://www.googleapis.com';

  async function request(path: string, init: { method?: string; body?: string; type?: string }) {
    let token = await options.accessToken();
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (init.type) headers['Content-Type'] = init.type;
      let response: FetchResponse;
      try {
        response = await options.fetch(`${base}${path}`, {
          method: init.method,
          headers,
          body: init.body,
        });
      } catch (error) {
        throw new DriveError(
          'network',
          `Couldn’t reach Google Drive. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (response.status === 401 && attempt === 0) {
        await options.invalidate(token);
        token = await options.accessToken();
        continue;
      }
      if (response.ok) return response;
      throw await errorFrom(response);
    }
  }

  async function json<T>(path: string, init: { method?: string; body?: string; type?: string }) {
    return JSON.parse(await (await request(path, init)).text()) as T;
  }

  const query = (q: string, fields: string, extra = '') =>
    `/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=${encodeURIComponent(fields)}${extra}`;

  return {
    async findOrCreateFolder() {
      const found = await json<{ files: { id: string }[] }>(
        query(
          `mimeType='${folderMime}' and name='${folderName}' and trashed=false and ${marker}`,
          'files(id)',
          '&pageSize=1',
        ),
        {},
      );
      if (found.files[0]) return found.files[0].id;
      const created = await json<{ id: string }>('/drive/v3/files?fields=id', {
        method: 'POST',
        type: 'application/json; charset=UTF-8',
        body: JSON.stringify({
          name: folderName,
          mimeType: folderMime,
          appProperties: { expenseTracker: 'backups' },
        }),
      });
      return created.id;
    },

    async list(folderId) {
      const result = await json<{
        files: {
          id: string;
          createdTime: string;
          size?: string;
          appProperties?: { transactions?: string };
        }[];
      }>(
        query(
          `'${folderId}' in parents and trashed=false and mimeType='application/json'`,
          'files(id,createdTime,size,appProperties)',
          '&orderBy=createdTime%20desc&pageSize=100',
        ),
        {},
      );
      return result.files.map((file) => ({
        id: file.id,
        createdAt: Date.parse(file.createdTime),
        size: Number(file.size ?? 0),
        transactions:
          file.appProperties?.transactions === undefined
            ? null
            : Number(file.appProperties.transactions),
      }));
    },

    async upload(folderId, name, text, transactions) {
      const boundary = `expense-tracker-${Math.random().toString(36).slice(2)}`;
      const metadata = {
        name,
        parents: [folderId],
        mimeType: 'application/json',
        appProperties: { transactions: String(transactions) },
      };
      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        'Content-Type: application/json',
        '',
        text,
        `--${boundary}--`,
        '',
      ].join('\r\n');
      const file = await json<{ id: string; createdTime: string }>(
        '/upload/drive/v3/files?uploadType=multipart&fields=id,createdTime',
        { method: 'POST', type: `multipart/related; boundary=${boundary}`, body },
      );
      return { id: file.id, createdAt: Date.parse(file.createdTime) };
    },

    async download(fileId) {
      return (await request(`/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {})).text();
    },

    async remove(fileId) {
      try {
        await request(`/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      } catch (error) {
        if (!(error instanceof DriveError && error.kind === 'notFound')) throw error;
      }
    },
  };
}

async function errorFrom(response: FetchResponse): Promise<DriveError> {
  let reason = '';
  let message = `Google Drive returned HTTP ${response.status}.`;
  try {
    const body = JSON.parse(await response.text()) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    };
    reason = body.error?.errors?.[0]?.reason ?? '';
    if (body.error?.message) message = body.error.message;
  } catch {
    // Keep the HTTP status message.
  }
  if (response.status === 401) return new DriveError('auth', message);
  if (response.status === 404) return new DriveError('notFound', message);
  if (reason === 'storageQuotaExceeded') return new DriveError('quota', message);
  if (response.status === 403 && /insufficient|forbidden|authError/i.test(reason))
    return new DriveError('auth', message);
  if (response.status === 429 || response.status >= 500 || /rateLimit/i.test(reason))
    return new DriveError('network', message);
  return new DriveError('other', message);
}
