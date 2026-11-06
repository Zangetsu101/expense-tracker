# Settle threads after merging into main

The repository's `.githooks/post-merge` runs `scripts/settle-merged-threads.mjs` after a successful local `git merge`. A companion `post-commit` hook handles merge commits completed after conflict resolution. Husky installs these hooks alongside the staged lint/format pre-commit hook when dependencies are installed:

```sh
pnpm install --frozen-lockfile
```

Husky sets `core.hooksPath` to `.githooks/_`, which resolves within the current checkout. Run the install in each linked worktree to generate its hook wrappers. Node.js 22 or later and the running local T3 desktop server are required for merge settlement. The `t3` CLI must be on PATH, or supplied through `T3CODE_CLI_PATH`.

On `main`, the hook compares `ORIG_HEAD` with `HEAD`. A local branch qualifies when its tip is now an ancestor of `HEAD` but was not an ancestor of `ORIG_HEAD`. This covers fast-forward, ordinary merge commits, and conflict resolutions completed with `git merge --continue`. Already merged branches and branches with unmerged commits are excluded. Squash merges are skipped.

For each qualifying branch, the hook selects exactly one unsettled top-level thread in this T3 project. Queued runs, pending requests, guest messages, background work, pinned threads, and threads with automatic settling disabled are skipped. Explicitly unsettled threads are also left active. Ambiguous matches are skipped. A guarded `thread.auto-settle` command rejects settlement if the thread changes after selection.

The hook reuses the device cleanup script's local T3 session helper: short-lived read/operate credentials remain in memory and are revoked on exit. Settling emits the normal T3 lifecycle event, triggering [device release](t3-device-cleanup.md) for threads with worktrees. Project-checkout threads still have the device release limitation described there.

If the matching thread is running, the hook starts a detached worker that waits up to 30 minutes for that same run to complete successfully. It subscribes to T3’s live thread status updates, then checks Git once after completion. It verifies the recorded branch tip is still merged into `main` and any surviving branch ref is unchanged, and rechecks eligibility before settling. A snapshot that omits the thread leaves the subscription open; only an explicit removal or a matching thread state change ends the wait before timeout. Failed or replaced runs remain active. Worker output goes to the clone's Git metadata file `t3-merge-settlement.log`. Each JSON record includes a timestamp and thread/run IDs. Records cover worker startup, the state that ended the subscription, settlement requests and successes, errors, and explicit skip reasons (including background task IDs and kinds, without command contents). The worker uses a one-hour credential, revoked when it exits; all other calls use one-minute credentials. T3 must remain running during the wait.

Failures print an error after the merge; they cannot undo the completed merge. T3 must be available at merge time. Skipped or failed settlements are not retried automatically. A worker timeout or T3 shutdown leaves the thread active.

Run `node scripts/settle-merged-threads.mjs --dry-run` immediately after a merge to inspect candidates without settling them. The hook handles local merges into `main`; remote merges, rebases, cherry-picks, and branch deletion are not triggers. Deleting a merged branch after the hook captures its tip does not prevent deferred settlement.

Verification:

```sh
node --test scripts/settle-merged-threads.test.mjs scripts/release-thread-devices.test.mjs
```

To replay a completed run without changing thread state, use `node scripts/settle-merged-threads.mjs --wait <thread-id> <run-id> <branch> <full-tip-sha> <project-root> --dry-run`. This prints the same diagnostic records; it does not reconstruct historical state.
