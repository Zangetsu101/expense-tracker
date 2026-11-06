import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withT3Session } from './t3-session.mjs';

export function selectSettledThread(snapshot, projectRoot, worktreePath) {
  const project = snapshot.projects.find((p) => resolve(p.workspaceRoot) === resolve(projectRoot));
  const matches = snapshot.threads.filter(
    (thread) =>
      thread.projectId === project?.id &&
      thread.worktreePath &&
      resolve(thread.worktreePath) === resolve(worktreePath) &&
      thread.lineage?.relationshipToParent !== 'subagent' &&
      thread.settledOverride === 'settled' &&
      thread.activeRunId === null,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one idle, settled thread for this worktree; found ${matches.length}.`,
    );
  }
  return matches[0];
}

export async function releaseThreadDevices(options = {}) {
  const env = options.env ?? process.env;
  const projectRoot = env.T3CODE_PROJECT_ROOT;
  const worktreePath = env.T3CODE_WORKTREE_PATH;
  if (!projectRoot || !worktreePath) {
    throw new Error(
      'Run as a T3 settlement hook with T3CODE_PROJECT_ROOT and T3CODE_WORKTREE_PATH.',
    );
  }
  return withT3Session(options, async ({ request, rpc }) => {
    const snapshot = await request('/api/orchestration/shell');
    const thread = selectSettledThread(snapshot, projectRoot, worktreePath);
    if (options.dryRun) return `Would release devices for thread ${thread.id}.`;
    await rpc('device.close', { threadId: thread.id, shutdown: false });
    return `Released devices for thread ${thread.id}.`;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(await releaseThreadDevices({ dryRun: process.argv.includes('--dry-run') }));
  } catch (error) {
    console.error(`Device cleanup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
