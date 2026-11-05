import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const timeoutMs = 10_000;

export function selectSettledThread(snapshot, projectRoot, worktreePath) {
  const project = snapshot.projects.find(p => resolve(p.workspaceRoot) === resolve(projectRoot));
  const matches = snapshot.threads.filter(thread =>
    thread.projectId === project?.id && thread.worktreePath &&
    resolve(thread.worktreePath) === resolve(worktreePath) &&
    thread.lineage?.relationshipToParent !== 'subagent' &&
    thread.settledOverride === 'settled' && thread.activeRunId === null,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one idle, settled thread for this worktree; found ${matches.length}.`);
  }
  return matches[0];
}

// T3 uses Effect RPC JSON frames on /ws; device.close omits deviceId to close all for a thread.
async function closeDevices(url, threadId, Socket) {
  return new Promise((resolveCall, reject) => {
    const socket = new Socket(url);
    const finish = error => {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolveCall();
    };
    const timer = setTimeout(() => finish(new Error('device.close timed out.')), timeoutMs);
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      _tag: 'Request', id: '1', tag: 'device.close',
      payload: { threadId, shutdown: false }, headers: [],
    })));
    socket.addEventListener('error', () => finish(new Error('Device connection failed.')), { once: true });
    socket.addEventListener('close', () => {
      clearTimeout(timer);
      reject(new Error('Device connection closed before acknowledgment.'));
    }, { once: true });
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); }
      catch { finish(new Error('Invalid device RPC response.')); return; }
      if (message._tag === 'Ping') { socket.send(JSON.stringify({ _tag: 'Pong' })); return; }
      if (message._tag !== 'Exit' || message.requestId !== '1') return;
      finish(message.exit?._tag === 'Success' ? null : new Error('device.close failed.'));
    });
  });
}

export async function releaseThreadDevices(options = {}) {
  const env = options.env ?? process.env;
  const projectRoot = env.T3CODE_PROJECT_ROOT;
  const worktreePath = env.T3CODE_WORKTREE_PATH;
  if (!projectRoot || !worktreePath) {
    throw new Error('Run as a T3 settlement hook with T3CODE_PROJECT_ROOT and T3CODE_WORKTREE_PATH.');
  }
  const t3Home = env.T3CODE_HOME ?? join(homedir(), '.t3');
  const cli = env.T3CODE_CLI_PATH ?? 't3';
  const run = options.execFile ?? execFile;
  const fetchApi = options.fetch ?? globalThis.fetch;
  const runtime = JSON.parse(await (options.readFile ?? readFile)(join(t3Home, 'userdata/server-runtime.json'), 'utf8'));
  const origin = new URL(runtime.origin);
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
    throw new Error('Expected a local T3 server origin.');
  }
  async function command(args) {
    try {
      return await run(cli, args, { encoding: 'utf8', timeout: timeoutMs, env, maxBuffer: 1024 * 1024 });
    } catch {
      throw new Error(`T3 credential ${args[2]} failed.`);
    }
  }
  const { stdout } = await command([
    'auth', 'session', 'issue', '--scope', 'orchestration:read',
    '--scope', 'orchestration:operate', '--ttl', '1m',
    '--label', 'settled thread device cleanup', '--json',
  ]);
  let credential;
  try { credential = JSON.parse(stdout); }
  catch { throw new Error('T3 returned an invalid credential response.'); }
  try {
    if (typeof credential?.token !== 'string' || !credential.token.trim() ||
        typeof credential?.sessionId !== 'string' || !credential.sessionId.trim()) {
      throw new Error('T3 returned an invalid credential response.');
    }
    async function request(path, method = 'GET') {
      let response;
      try {
        response = await fetchApi(new URL(path, origin), {
          method, signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
          headers: { authorization: `Bearer ${credential.token}`, 'x-t3-orchestration-protocol': '2' },
        });
      } catch { throw new Error('T3 request failed.'); }
      if (!response.ok) throw new Error(`T3 request failed: HTTP ${response.status}.`);
      return response.json();
    }
    const snapshot = await request('/api/orchestration/shell');
    const thread = selectSettledThread(snapshot, projectRoot, worktreePath);
    if (options.dryRun) return `Would release devices for thread ${thread.id}.`;
    const { ticket } = await request('/api/auth/websocket-ticket/rpc', 'POST');
    const url = new URL('/ws', origin);
    url.protocol = 'ws:';
    url.searchParams.set('wsTicket', ticket);
    url.searchParams.set('orchestrationProtocol', '2');
    await closeDevices(url, thread.id, options.WebSocket ?? globalThis.WebSocket);
    return `Released devices for thread ${thread.id}.`;
  } finally {
    if (typeof credential?.sessionId === 'string' && credential.sessionId.trim()) {
      await command(['auth', 'session', 'revoke', credential.sessionId]);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(await releaseThreadDevices({ dryRun: process.argv.includes('--dry-run') }));
  } catch (error) {
    console.error(`Device cleanup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
