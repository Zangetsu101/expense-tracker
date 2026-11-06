import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const timeoutMs = 10_000;

// T3 uses Effect RPC JSON frames on /ws.
async function callRpc(url, tag, payload, Socket) {
  return new Promise((resolveCall, reject) => {
    const socket = new Socket(url);
    const finish = error => {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolveCall();
    };
    const timer = setTimeout(() => finish(new Error(`${tag} timed out.`)), timeoutMs);
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      _tag: 'Request', id: '1', tag,
      payload, headers: [],
    })));
    socket.addEventListener('error', () => finish(new Error('T3 connection failed.')), { once: true });
    socket.addEventListener('close', () => {
      clearTimeout(timer);
      reject(new Error('T3 connection closed before acknowledgment.'));
    }, { once: true });
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); }
      catch { finish(new Error('Invalid T3 RPC response.')); return; }
      if (message._tag === 'Ping') { socket.send(JSON.stringify({ _tag: 'Pong' })); return; }
      if (message._tag !== 'Exit' || message.requestId !== '1') return;
      finish(message.exit?._tag === 'Success' ? null : new Error(`${tag} failed.`));
    });
  });
}

export async function withT3Session(options, callback) {
  const env = options.env ?? process.env;
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
    '--scope', 'orchestration:operate', '--ttl', options.sessionTtl ?? '1m',
    '--label', 'thread lifecycle hook', '--json',
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
    async function rpc(tag, payload) {
      const { ticket } = await request('/api/auth/websocket-ticket/rpc', 'POST');
      const url = new URL('/ws', origin);
      url.protocol = 'ws:';
      url.searchParams.set('wsTicket', ticket);
      url.searchParams.set('orchestrationProtocol', '2');
      return callRpc(url, tag, payload, options.WebSocket ?? globalThis.WebSocket);
    }
    return await callback({ request, rpc });
  } finally {
    if (typeof credential?.sessionId === 'string' && credential.sessionId.trim()) {
      await command(['auth', 'session', 'revoke', credential.sessionId]);
    }
  }
}
