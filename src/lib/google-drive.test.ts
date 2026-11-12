/**
 * @jest-environment node
 */
/// <reference types="node" />
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DriveError } from './drive-backups';
import { createGoogleDrive } from './google-drive';

type Seen = { method: string; url: URL; headers: http.IncomingHttpHeaders; body: string };
type Reply = { status: number; body?: unknown };

/** A local HTTP server that acts as the Drive API. Each test queues the replies. */
let server: http.Server;
let base: string;
let seen: Seen[];
let replies: (Reply | ((request: Seen) => Reply))[];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const request = {
        method: req.method!,
        url: new URL(req.url!, base),
        headers: req.headers,
        body,
      };
      seen.push(request);
      const next = replies.shift() ?? { status: 500 };
      const reply = typeof next === 'function' ? next(request) : next;
      res.statusCode = reply.status;
      res.end(
        reply.body === undefined
          ? ''
          : typeof reply.body === 'string'
            ? reply.body
            : JSON.stringify(reply.body),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  seen = [];
  replies = [];
});

/** Jest's React Native setup replaces `fetch`, so the tests use node:http directly. */
function nodeFetch(
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string },
) {
  return new Promise<{ ok: boolean; status: number; text(): Promise<string> }>(
    (resolve, reject) => {
      const req = http.request(
        url,
        { method: init.method ?? 'GET', headers: init.headers },
        (res) => {
          let text = '';
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () =>
            resolve({
              ok: res.statusCode! >= 200 && res.statusCode! < 300,
              status: res.statusCode!,
              text: async () => text,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(init.body);
    },
  );
}

function client(tokens = ['token-1', 'token-2']) {
  const invalidated: string[] = [];
  let index = 0;
  const drive = createGoogleDrive({
    accessToken: async () => tokens[Math.min(index, tokens.length - 1)],
    invalidate: async (token) => {
      invalidated.push(token);
      index++;
    },
    fetch: nodeFetch,
    baseUrl: base,
  });
  return { drive, invalidated };
}

const driveError = (status: number, reason: string, message = `Drive said ${reason}`) => ({
  status,
  body: { error: { code: status, message, errors: [{ reason }] } },
});

test('findOrCreateFolder reuses the app folder and makes one when there is none', async () => {
  const { drive } = client();
  replies.push({ status: 200, body: { files: [{ id: 'existing' }] } });
  expect(await drive.findOrCreateFolder()).toBe('existing');
  const q = seen[0].url.searchParams.get('q')!;
  expect(q).toContain("name='Expense Tracker Backups'");
  expect(q).toContain("appProperties has { key='expenseTracker' and value='backups' }");
  expect(q).toContain('trashed=false');
  expect(seen[0].headers.authorization).toBe('Bearer token-1');

  replies.push({ status: 200, body: { files: [] } }, { status: 200, body: { id: 'new-folder' } });
  expect(await drive.findOrCreateFolder()).toBe('new-folder');
  expect(seen[2].method).toBe('POST');
  expect(JSON.parse(seen[2].body)).toEqual({
    name: 'Expense Tracker Backups',
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: { expenseTracker: 'backups' },
  });
});

test('upload sends multipart metadata with the transaction count, and the file text', async () => {
  const { drive } = client();
  replies.push({ status: 200, body: { id: 'file-1', createdTime: '2026-11-09T09:12:00.000Z' } });
  const json = '{"schemaVersion":1,"note":"ünïcode"}';
  expect(await drive.upload('folder-1', 'expense-backup.json', json, 42)).toEqual({
    id: 'file-1',
    createdAt: Date.parse('2026-11-09T09:12:00.000Z'),
  });
  const [request] = seen;
  expect(request.url.pathname).toBe('/upload/drive/v3/files');
  expect(request.url.searchParams.get('uploadType')).toBe('multipart');
  const boundary = /boundary=(.+)$/.exec(request.headers['content-type']!)![1];
  const parts = request.body.split(`--${boundary}`);
  expect(JSON.parse(parts[1].split('\r\n\r\n')[1])).toEqual({
    name: 'expense-backup.json',
    parents: ['folder-1'],
    mimeType: 'application/json',
    appProperties: { transactions: '42' },
  });
  expect(parts[2].split('\r\n\r\n')[1]).toBe(`${json}\r\n`);
  expect(parts[3]).toBe('--\r\n');
});

test('list returns date, size and transaction count; download returns the text', async () => {
  const { drive } = client();
  replies.push({
    status: 200,
    body: {
      files: [
        {
          id: 'b',
          createdTime: '2026-11-08T09:00:00.000Z',
          size: '1200',
          appProperties: { transactions: '7' },
        },
        { id: 'a', createdTime: '2026-11-07T09:00:00.000Z' },
      ],
    },
  });
  expect(await drive.list('folder-1')).toEqual([
    { id: 'b', createdAt: Date.parse('2026-11-08T09:00:00.000Z'), size: 1200, transactions: 7 },
    { id: 'a', createdAt: Date.parse('2026-11-07T09:00:00.000Z'), size: 0, transactions: null },
  ]);
  expect(seen[0].url.searchParams.get('q')).toBe(
    "'folder-1' in parents and trashed=false and mimeType='application/json'",
  );

  replies.push({ status: 200, body: '{"schemaVersion":1}' });
  expect(await drive.download('b')).toBe('{"schemaVersion":1}');
  expect(seen[1].url.pathname).toBe('/drive/v3/files/b');
  expect(seen[1].url.searchParams.get('alt')).toBe('media');
});

test('remove deletes the file, and a file that is already gone counts as removed', async () => {
  const { drive } = client();
  replies.push({ status: 204 }, driveError(404, 'notFound'));
  await drive.remove('a');
  await drive.remove('gone');
  expect(seen.map((request) => [request.method, request.url.pathname])).toEqual([
    ['DELETE', '/drive/v3/files/a'],
    ['DELETE', '/drive/v3/files/gone'],
  ]);
});

test('a refused token is replaced once; a second refusal is an auth failure', async () => {
  const { drive, invalidated } = client();
  replies.push({ status: 401 }, { status: 200, body: '{}' });
  expect(await drive.download('a')).toBe('{}');
  expect(invalidated).toEqual(['token-1']);
  expect(seen[1].headers.authorization).toBe('Bearer token-2');

  replies.push({ status: 401 }, driveError(401, 'authError', 'Invalid Credentials'));
  await expect(drive.download('a')).rejects.toMatchObject({
    kind: 'auth',
    message: 'Invalid Credentials',
  });
});

test.each([
  [
    driveError(403, 'storageQuotaExceeded', 'The user’s Drive storage quota has been exceeded.'),
    'quota',
  ],
  [driveError(403, 'insufficientFilePermissions'), 'auth'],
  [driveError(403, 'userRateLimitExceeded'), 'network'],
  [driveError(429, 'rateLimitExceeded'), 'network'],
  [{ status: 503, body: 'Service Unavailable' }, 'network'],
  [driveError(404, 'notFound'), 'notFound'],
  [driveError(400, 'badRequest'), 'other'],
] as const)('HTTP %j becomes a %s failure', async (reply, kind) => {
  const { drive } = client();
  replies.push(reply);
  const error = await drive.upload('folder-1', 'a.json', '{}', 0).catch((caught) => caught);
  expect(error).toBeInstanceOf(DriveError);
  expect(error.kind).toBe(kind);
});

test('a request that cannot reach Drive is a network failure', async () => {
  const drive = createGoogleDrive({
    accessToken: async () => 'token',
    invalidate: async () => {},
    fetch: nodeFetch,
    baseUrl: 'http://127.0.0.1:1',
  });
  await expect(drive.download('a')).rejects.toMatchObject({ kind: 'network' });
});
