import { execFileSync, spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withT3Session } from './t3-session.mjs';

export function mergedBranches(git) {
  if (git(['symbolic-ref', '--quiet', 'HEAD']).trim() !== 'refs/heads/main') return [];
  const before = git(['rev-parse', '--verify', 'ORIG_HEAD']).trim();
  const after = git(['rev-parse', 'HEAD']).trim();
  if (before === after) return [];
  return git(['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads/']).trim().split('\n')
    .filter(branch => branch && branch !== 'main')
    .filter(branch => {
      try { git(['merge-base', '--is-ancestor', `refs/heads/${branch}`, after]); }
      catch { return false; }
      try { git(['merge-base', '--is-ancestor', `refs/heads/${branch}`, before]); }
      catch { return true; }
      return false;
    });
}

function ineligibleReason(thread, includeRunning) {
  if (thread.activityRunStatus != null && thread.activeRunId == null) return 'activity-without-active-run';
  if (!includeRunning && (thread.activeRunId != null || thread.activityRunStatus != null)) return 'run-still-active';
  if (thread.pendingRuntimeRequest != null) return 'pending-request';
  if ((thread.pendingGuestMessageCount ?? 0) > 0) return 'pending-guest-messages';
  if ((includeRunning ? ['queued'] : ['queued', 'preparing', 'starting', 'running', 'waiting']).includes(thread.status)) return 'run-status-not-idle';
  if ((thread.pendingBackgroundTasks?.length ?? 0) > 0) return 'background-tasks';
  if (thread.pinnedAt != null) return 'pinned';
  if (thread.autoSettleDisabledAt != null) return 'auto-settle-disabled';
  if (thread.settledOverride === 'active') return 'explicitly-active';
  return null;
}

export function selectMergedThreads(snapshot, projectRoot, branches, includeRunning = false, report = () => {}) {
  const project = snapshot.projects.find(p => resolve(p.workspaceRoot) === resolve(projectRoot));
  return branches.flatMap(branch => {
    const matches = snapshot.threads.filter(thread =>
      thread.projectId === project?.id && thread.branch === branch &&
      thread.archivedAt == null && thread.deletedAt == null && thread.settledAt == null &&
      thread.settledOverride !== 'settled' &&
      thread.lineage?.relationshipToParent !== 'subagent',
    );
    if (matches.length !== 1) {
      report({ reason: project ? 'matching-thread-count' : 'project-not-found', branch, count: matches.length });
      return [];
    }
    const thread = matches[0];
    const reason = ineligibleReason(thread, includeRunning);
    if (reason) { report({ reason, threadId: thread.id, branch, status: thread.status,
      backgroundTasks: thread.pendingBackgroundTasks?.map(t => ({ taskId: t.taskId, kind: t.kind })) }); return []; }
    return [thread];
  });
}

function diagnostics(input, options) {
  const log = options.log ?? console.log;
  return (event, fields = {}) => log(JSON.stringify({
    timestamp: new Date().toISOString(), event, threadId: input.threadId, runId: input.runId, ...fields,
  }));
}

const scriptPath = fileURLToPath(import.meta.url);
const defaultGit = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function deferSettlement(thread, projectRoot, git) {
  const tip = git(['rev-parse', `refs/heads/${thread.branch}`]).trim();
  const logPath = git(['rev-parse', '--path-format=absolute', '--git-path', 't3-merge-settlement.log']).trim();
  const log = openSync(logPath, 'a', 0o600);
  try {
    const worker = spawn(process.execPath, [scriptPath, '--wait', thread.id, thread.activeRunId, thread.branch, tip, projectRoot], {
      detached: true, stdio: ['ignore', log, log],
    });
    worker.on('error', error => console.error(`Could not defer thread settlement: ${error.message}`));
    worker.unref();
  } finally { closeSync(log); }
}

export async function waitForMergedThread(input, options = {}) {
  const git = options.git ?? defaultGit;
  const report = diagnostics(input, options);
  report('worker-started', { branch: input.branch, tip: input.tip, projectRoot: input.projectRoot });
  return withT3Session({ ...options, sessionTtl: '1h' }, async ({ request, rpc, subscribe }) => {
    await subscribe('orchestration.subscribeShell', {}, update => {
      let thread;
      if (update.kind === 'snapshot') thread = update.snapshot.threads.find(t => t.id === input.threadId);
      else if (update.kind === 'thread.updated' && update.thread.id === input.threadId) thread = update.thread;
      else {
        if (update.kind !== 'thread.removed' || update.threadId !== input.threadId) return false;
        report('subscription-ended', { reason: 'thread-removed' });
        return true;
      }
      if (!thread) {
        report('subscription-waiting', { reason: 'thread-missing-from-snapshot' });
        return false;
      }
      const done = thread.latestRunId !== input.runId || thread.branch !== input.branch ||
        (thread.activeRunId == null && thread.activityRunStatus == null);
      if (done) report('subscription-ended', { reason: 'state-changed',
        latestRunId: thread?.latestRunId, activeRunId: thread?.activeRunId,
        activityRunStatus: thread?.activityRunStatus, status: thread?.status, branch: thread?.branch });
      return done;
    }, options.waitMs ?? 30 * 60 * 1000);

    const snapshot = await request('/api/orchestration/shell');
    const thread = snapshot.threads.find(t => t.id === input.threadId);
    const reason = !thread ? 'thread-missing' : thread.latestRunId !== input.runId ? 'run-replaced' :
      thread.branch !== input.branch ? 'thread-branch-changed' : thread.status !== 'completed' ? 'run-not-completed' :
      thread.settledAt != null || thread.settledOverride === 'settled' ? 'already-settled' : null;
    if (reason) { report('settlement-skipped', { reason, status: thread?.status, latestRunId: thread?.latestRunId, branch: thread?.branch }); return; }
    const eligible = selectMergedThreads(snapshot, input.projectRoot, [input.branch], false,
      fields => report('settlement-skipped', fields));
    if (!eligible.some(t => t.id === input.threadId)) return;
    let currentTip;
    try { currentTip = git(['show-ref', '--verify', '--hash', `refs/heads/${input.branch}`]).trim(); }
    catch { currentTip = null; }
    if (currentTip !== null && currentTip !== input.tip) {
      report('settlement-skipped', { reason: 'branch-tip-changed', expectedTip: input.tip, currentTip });
      return;
    }
    git(['merge-base', '--is-ancestor', input.tip, 'refs/heads/main']);
    if (options.dryRun) { report('would-settle'); return; }
    report('settlement-requested');
    await rpc('orchestration.dispatchCommand', {
      type: 'thread.auto-settle', commandId: randomUUID(), threadId: thread.id,
      snapshotAt: thread.updatedAt,
    });
    report('settlement-succeeded');
  }).catch(error => {
    report('worker-failed', { message: error.message });
    throw error;
  });
}

export async function settleMergedThreads(options = {}) {
  const git = options.git ?? defaultGit;
  const branches = mergedBranches(git);
  if (branches.length === 0) return 'No newly merged branches into main.';
  const projectRoot = git(['worktree', 'list', '--porcelain']).split('\n')[0].slice('worktree '.length);
  return withT3Session(options, async ({ request, rpc }) => {
    const snapshot = await request('/api/orchestration/shell');
    const threads = selectMergedThreads(snapshot, projectRoot, branches, true);
    let deferred = 0;
    for (const thread of threads) {
      if (thread.activeRunId != null) {
        deferred++;
        if (!options.dryRun) (options.defer ?? deferSettlement)(thread, projectRoot, git);
        continue;
      }
      if (options.dryRun) continue;
      // The server rejects this if the thread changes after the snapshot.
      await rpc('orchestration.dispatchCommand', {
        type: 'thread.auto-settle', commandId: randomUUID(), threadId: thread.id,
        snapshotAt: thread.updatedAt,
      });
    }
    return `${options.dryRun ? 'Would settle' : 'Settled'} ${threads.length - deferred} thread(s); ${deferred} deferred until run completion for merged branches: ${branches.join(', ')}. Ambiguous, pinned, or opted-out threads are skipped.`;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Git passes 1 for squash merges, which do not preserve branch ancestry.
  if (process.argv[2] !== '1') {
    try {
      if (process.argv[2] === '--wait') {
        const [threadId, runId, branch, tip, projectRoot] = process.argv.slice(3);
        await waitForMergedThread({ threadId, runId, branch, tip, projectRoot }, { dryRun: process.argv.includes('--dry-run') });
      } else console.log(await settleMergedThreads({ dryRun: process.argv.includes('--dry-run') }));
    }
    catch (error) {
      console.error(`Thread settlement failed (merge is complete): ${error.message}`);
      process.exitCode = 1;
    }
  }
}
