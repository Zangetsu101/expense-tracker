import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseThreadDevices, selectSettledThread } from './release-thread-devices.mjs';

const project = { id: 'expense', workspaceRoot: '/projects/expense' };
const settled = {
  id: 'settled',
  projectId: 'expense',
  worktreePath: '/worktrees/fix',
  settledOverride: 'settled',
  activeRunId: null,
  lineage: { relationshipToParent: null },
};
const snapshot = (threads = [settled]) => ({ projects: [project], threads, archivedThreads: [] });

function harness(threads = [settled]) {
  const commands = [];
  const requests = [];
  const frames = [];
  let rpcFailure = false;
  class Socket extends EventTarget {
    constructor(url) {
      super();
      assert.equal(url.searchParams.get('orchestrationProtocol'), '2');
      assert.equal(url.searchParams.get('wsTicket'), 'ticket-secret');
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(data) {
      const request = JSON.parse(data);
      frames.push(request);
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({
              _tag: 'Exit',
              requestId: request.id,
              exit: rpcFailure ? { _tag: 'Failure', cause: {} } : { _tag: 'Success' },
            }),
          }),
        ),
      );
    }
    close() {}
  }
  return {
    commands,
    requests,
    frames,
    failRpc() {
      rpcFailure = true;
    },
    options: {
      env: {
        T3CODE_PROJECT_ROOT: project.workspaceRoot,
        T3CODE_WORKTREE_PATH: settled.worktreePath,
        T3CODE_HOME: '/t3',
        T3CODE_CLI_PATH: '/bin/t3',
      },
      dryRun: false,
      readFile: async () => JSON.stringify({ origin: 'http://127.0.0.1:3773' }),
      execFile: async (cli, args) => {
        commands.push({ cli, args });
        return {
          stdout: args.includes('issue')
            ? JSON.stringify({ token: 'bearer-secret', sessionId: 'credential' })
            : '',
        };
      },
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        assert.equal(init.headers.authorization, 'Bearer bearer-secret');
        return Response.json(
          String(url).endsWith('/shell') ? snapshot(threads) : { ticket: 'ticket-secret' },
        );
      },
      WebSocket: Socket,
    },
  };
}

test('settlement hook releases only the settled worktree thread and leaves devices running', async () => {
  const h = harness([
    settled,
    {
      ...settled,
      id: 'active',
      worktreePath: '/worktrees/other',
      settledOverride: null,
      activeRunId: 'run',
    },
  ]);
  assert.equal(await releaseThreadDevices(h.options), 'Released devices for thread settled.');
  assert.deepEqual(h.frames, [
    {
      _tag: 'Request',
      id: '1',
      tag: 'device.close',
      payload: { threadId: 'settled', shutdown: false },
      headers: [],
    },
  ]);
  assert.deepEqual(h.commands.at(-1).args, ['auth', 'session', 'revoke', 'credential']);
  assert.deepEqual(
    h.commands[0].args.filter((v, i, a) => a[i - 1] === '--scope'),
    ['orchestration:read', 'orchestration:operate'],
  );
  assert.ok(h.commands[0].args.includes('1m'));
});

test('selection rejects active, running, foreign, absent, and ambiguous threads', () => {
  for (const threads of [
    [],
    [{ ...settled, settledOverride: null }],
    [{ ...settled, activeRunId: 'run' }],
    [{ ...settled, projectId: 'other' }],
    [{ ...settled, worktreePath: null }],
    [settled, { ...settled, id: 'duplicate' }],
  ]) {
    assert.throws(() =>
      selectSettledThread(snapshot(threads), project.workspaceRoot, settled.worktreePath),
    );
  }
  assert.equal(
    selectSettledThread(
      snapshot([
        settled,
        { ...settled, id: 'child', lineage: { relationshipToParent: 'subagent' } },
      ]),
      project.workspaceRoot,
      settled.worktreePath,
    ).id,
    'settled',
  );
});

test('invalid selection never closes a device and still revokes the credential', async () => {
  const h = harness([{ ...settled, settledOverride: null }]);
  await assert.rejects(releaseThreadDevices(h.options), /settled/);
  assert.equal(h.frames.length, 0);
  assert.equal(h.commands.at(-1).args[2], 'revoke');
});

test('RPC failures fail the hook and revoke the credential', async () => {
  const h = harness();
  h.failRpc();
  await assert.rejects(releaseThreadDevices(h.options), /device.close failed/);
  assert.equal(h.commands.at(-1).args[2], 'revoke');
});

test('dry run resolves the live thread without opening a device connection', async () => {
  const h = harness();
  h.options.dryRun = true;
  assert.equal(await releaseThreadDevices(h.options), 'Would release devices for thread settled.');
  assert.equal(h.frames.length, 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.commands.at(-1).args[2], 'revoke');
});

test('missing hook environment fails before issuing credentials', async () => {
  const h = harness();
  delete h.options.env.T3CODE_WORKTREE_PATH;
  await assert.rejects(releaseThreadDevices(h.options), /T3CODE_WORKTREE_PATH/);
  assert.equal(h.commands.length, 0);
});

test('HTTP errors revoke credentials without exposing bearer tokens', async () => {
  const h = harness();
  h.options.fetch = async () => new Response('bearer-secret', { status: 500 });
  await assert.rejects(
    releaseThreadDevices(h.options),
    (error) => /HTTP 500/.test(error.message) && !error.message.includes('bearer-secret'),
  );
  assert.equal(h.commands.at(-1).args[2], 'revoke');
});

test('malformed or incomplete CLI credentials fail without revealing their contents', async () => {
  for (const stdout of [
    'sensitive-bearer-token',
    JSON.stringify({ token: 'sensitive-bearer-token' }),
    'null',
  ]) {
    const h = harness();
    h.options.execFile = async () => ({ stdout });
    await assert.rejects(
      releaseThreadDevices(h.options),
      (error) => error.message === 'T3 returned an invalid credential response.',
    );
    assert.equal(h.requests.length, 0);
    assert.equal(h.frames.length, 0);
  }
});

test('an incomplete credential with a session id is revoked before failing', async () => {
  const h = harness();
  const run = h.options.execFile;
  h.options.execFile = async (cli, args, options) =>
    args.includes('issue')
      ? { stdout: JSON.stringify({ sessionId: 'credential' }) }
      : run(cli, args, options);
  await assert.rejects(releaseThreadDevices(h.options), /invalid credential response/);
  assert.deepEqual(h.commands.at(-1).args, ['auth', 'session', 'revoke', 'credential']);
  assert.equal(h.requests.length, 0);
});
