import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { mergedBranches, selectMergedThreads, settleMergedThreads, waitForMergedThread } from './settle-merged-threads.mjs';

const project = { id: 'project', workspaceRoot: '/project' };
const thread = {
  id: 'thread', projectId: project.id, branch: 'feature', updatedAt: '2026-11-06T00:00:00.000Z',
  settledOverride: null, activeRunId: null,
};
const snapshot = threads => ({ projects: [project], threads });

test('real Git ancestry detects fast-forward and merge commits, ignoring old and unmerged branches', () => {
  for (const mode of ['--ff-only', '--no-ff']) {
    const cwd = mkdtempSync(join(tmpdir(), 'settle-merge-'));
    const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      git(['init', '-b', 'main']);
      git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.com']);
      git(['config', 'core.hooksPath', '/dev/null']);
      writeFileSync(join(cwd, 'file'), 'base'); git(['add', '.']); git(['commit', '-m', 'base']);
      git(['branch', 'old']); git(['checkout', '-b', 'feature']);
      writeFileSync(join(cwd, 'file'), 'feature'); git(['commit', '-am', 'feature']);
      assert.deepEqual(mergedBranches(git), []);
      git(['checkout', '-b', 'unmerged']);
      writeFileSync(join(cwd, 'file'), 'later'); git(['commit', '-am', 'later']);
      git(['tag', 'feature']);
      git(['checkout', 'main']); git(['tag', 'main']); git(['merge', mode, 'refs/heads/feature', '-m', 'merge']);
      assert.deepEqual(mergedBranches(git), ['feature']);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test('only one eligible thread for a newly merged branch is selected', () => {
  assert.deepEqual(selectMergedThreads(snapshot([thread]), '/project', ['feature']), [thread]);
  for (const changes of [
    { projectId: 'other' }, { branch: 'other' }, { archivedAt: 'date' }, { settledAt: 'date' },
    { settledOverride: 'settled' }, { settledOverride: 'active' }, { activeRunId: 'run' },
    { activityRunStatus: 'running' }, { pendingRuntimeRequest: {} }, { pendingGuestMessageCount: 1 },
    { status: 'queued' }, { pendingBackgroundTasks: [{}] }, { deletedAt: 'date' },
    { pinnedAt: 'date' }, { autoSettleDisabledAt: 'date' }, { lineage: { relationshipToParent: 'subagent' } },
  ]) assert.deepEqual(selectMergedThreads(snapshot([{ ...thread, ...changes }]), '/project', ['feature']), []);
  assert.deepEqual(selectMergedThreads(snapshot([thread, { ...thread, id: 'duplicate' }]), '/project', ['feature']), []);
});

function harness() {
  const frames = [], commands = [];
  let updates = [{ kind: 'snapshot', snapshot: snapshot([{ ...thread, latestRunId: 'run', status: 'completed' }]) }];
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(data) {
      const frame = JSON.parse(data); frames.push(frame);
      if (frame._tag === 'Ack' || frame._tag === 'Pong') return;
      if (frame.tag === 'orchestration.subscribeShell') {
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
          _tag: 'Chunk', requestId: frame.id, values: updates,
        }) })));
        return;
      }
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
        _tag: 'Exit', requestId: frame.id, exit: { _tag: 'Success' },
      }) })));
    }
    close() {}
  }
  return { frames, commands, setUpdates(value) { updates = value; }, options: {
    git: args => {
      if (args[0] === 'symbolic-ref') return 'refs/heads/main\n';
      if (args[0] === 'rev-parse') return args.at(-1) === 'HEAD' ? 'after' : 'before';
      if (args[0] === 'for-each-ref') return 'main\nfeature\n';
      if (args[0] === 'worktree') return 'worktree /project\n';
      if (args.at(-1) === 'before') throw new Error('not ancestor');
      return '';
    },
    env: { T3CODE_CLI_PATH: '/bin/t3' },
    readFile: async () => JSON.stringify({ origin: 'http://127.0.0.1:3773' }),
    execFile: async (_cli, args) => {
      commands.push(args);
      return { stdout: args.includes('issue') ? JSON.stringify({ token: 'secret', sessionId: 'credential' }) : '' };
    },
    fetch: async url => Response.json(String(url).endsWith('/shell') ? snapshot([thread]) : { ticket: 'ticket' }),
    WebSocket: Socket,
  } };
}

test('merge hook sends guarded automatic settlement and revokes credentials', async () => {
  const h = harness();
  assert.match(await settleMergedThreads(h.options), /Settled 1 thread/);
  assert.equal(h.frames[0].tag, 'orchestration.dispatchCommand');
  assert.deepEqual(h.frames[0].payload, {
    type: 'thread.auto-settle', threadId: thread.id, snapshotAt: thread.updatedAt,
    commandId: h.frames[0].payload.commandId,
  });
  assert.deepEqual(h.commands.at(-1), ['auth', 'session', 'revoke', 'credential']);
});

test('dry run reads candidates without settling; feature merges never contact T3', async () => {
  const h = harness();
  assert.match(await settleMergedThreads({ ...h.options, dryRun: true }), /Would settle 1/);
  assert.equal(h.frames.length, 0);
  h.commands.length = 0;
  assert.match(await settleMergedThreads({ ...h.options, git: () => 'feature' }), /No newly/);
  assert.equal(h.commands.length, 0);
});


test('conflicted merge completion invokes the installed hook', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'settle-conflict-'));
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_EDITOR: 'true' } });
  try {
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.com']);
    mkdirSync(join(cwd, '.githooks')); mkdirSync(join(cwd, 'scripts'));
    for (const name of ['post-merge', 'post-commit']) {
      copyFileSync(resolve('.githooks', name), join(cwd, '.githooks', name));
      chmodSync(join(cwd, '.githooks', name), 0o755);
    }
    writeFileSync(join(cwd, 'scripts/settle-merged-threads.mjs'), "import { appendFileSync } from 'node:fs'; appendFileSync('hook-ran', 'merge\\n');");
    git(['config', 'core.hooksPath', join(cwd, '.githooks')]);
    writeFileSync(join(cwd, 'file'), 'base'); git(['add', '.']); git(['commit', '-m', 'base']);
    git(['checkout', '-b', 'feature']);
    writeFileSync(join(cwd, 'file'), 'feature'); git(['commit', '-am', 'feature']);
    git(['checkout', 'main']);
    writeFileSync(join(cwd, 'file'), 'main'); git(['commit', '-am', 'main']);
    assert.throws(() => git(['merge', 'feature']));
    writeFileSync(join(cwd, 'file'), 'resolved'); git(['add', 'file']); git(['merge', '--continue']);
    assert.equal(readFileSync(join(cwd, 'hook-ran'), 'utf8'), 'merge\n');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('running merged threads defer until the same run completes', async () => {
  const h = harness();
  const running = { ...thread, activeRunId: 'run', latestRunId: 'run', status: 'running' };
  h.options.fetch = async url => Response.json(String(url).endsWith('/shell') ? snapshot([running]) : { ticket: 'ticket' });
  const deferred = [];
  assert.match(await settleMergedThreads({ ...h.options, defer: t => deferred.push(t.id) }), /1 deferred/);
  assert.deepEqual(deferred, ['thread']);
  assert.equal(h.frames.length, 0);
  h.setUpdates([
    { kind: 'snapshot', snapshot: snapshot([running]) },
    { kind: 'thread.updated', thread: { ...running, id: 'unrelated', activeRunId: null } },
    { kind: 'thread.updated', thread: { ...running, activeRunId: null, status: 'completed' } },
  ]);
  let reads = 0;
  h.options.fetch = async url => {
    if (String(url).endsWith('/shell')) reads++;
    return Response.json(String(url).endsWith('/shell')
      ? snapshot([{ ...running, activeRunId: null, status: 'completed' }]) : { ticket: 'ticket' });
  };
  const input = { threadId: 'thread', runId: 'run', branch: 'feature', tip: 'tip', projectRoot: '/project' };
  const git = args => args[0] === 'show-ref' ? 'tip' : '';
  await waitForMergedThread(input, { ...h.options, git });
  assert.equal(reads, 1);
  assert.deepEqual(h.frames.filter(f => f._tag === 'Request').map(f => f.tag), [
    'orchestration.subscribeShell', 'orchestration.dispatchCommand',
  ]);
  assert.equal(h.frames.find(f => f.tag === 'orchestration.dispatchCommand').payload.threadId, 'thread');
  assert.deepEqual(h.commands.at(-1), ['auth', 'session', 'revoke', 'credential']);
});

test('deferred settlement leaves failed, replaced, and changed-branch runs active', async () => {
  for (const changes of [{ status: 'failed' }, { latestRunId: 'new-run' }, { branch: 'other' }, { pinnedAt: 'date' }]) {
    const h = harness();
    h.options.fetch = async () => Response.json(snapshot([{ ...thread, latestRunId: 'run', status: 'completed', ...changes }]));
    await waitForMergedThread({ threadId: 'thread', runId: 'run', branch: 'feature', tip: 'tip', projectRoot: '/project' }, {
      ...h.options, git: args => args[0] === 'show-ref' ? 'tip' : '',
    });
    assert.equal(h.frames.filter(f => f.tag === 'orchestration.dispatchCommand').length, 0);
    assert.deepEqual(h.commands.at(-1), ['auth', 'session', 'revoke', 'credential']);
  }
});


test('deferred worker accepts deleted merged branch but rejects a moved branch', async () => {
  for (const deleted of [true, false]) {
    const h = harness();
    h.options.fetch = async url => Response.json(String(url).endsWith('/shell')
      ? snapshot([{ ...thread, latestRunId: 'run', status: 'completed' }]) : { ticket: 'ticket' });
    await waitForMergedThread({ threadId: 'thread', runId: 'run', branch: 'feature', tip: 'tip', projectRoot: '/project' }, {
      ...h.options, git: args => {
        if (args[0] === 'show-ref') {
          if (deleted) throw new Error('branch deleted');
          return 'moved-tip';
        }
        return '';
      },
    });
    assert.equal(h.frames.filter(f => f.tag === 'orchestration.dispatchCommand').length, deleted ? 1 : 0);
  }
});


test('subscription timeout closes the connection and revokes credentials without settling', async () => {
  const h = harness();
  h.setUpdates([{ kind: 'snapshot', snapshot: snapshot([{ ...thread, latestRunId: 'run', activeRunId: 'run' }]) }]);
  let gitCalls = 0;
  await assert.rejects(waitForMergedThread({ threadId: 'thread', runId: 'run', branch: 'feature' }, {
    ...h.options, waitMs: 10, git: () => { gitCalls++; },
  }), /subscribeShell timed out/);
  assert.equal(gitCalls, 0);
  assert.equal(h.frames.filter(f => f.tag === 'orchestration.dispatchCommand').length, 0);
  assert.deepEqual(h.commands.at(-1), ['auth', 'session', 'revoke', 'credential']);
});
