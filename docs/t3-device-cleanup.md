# Release devices when a T3 thread settles

The expense-tracker T3 project has a script with `runOnSettle: true` in its effective project settings, stored under `projectSettingsOverrides[projectId].defaultProjectScripts`:

```sh
T3CODE_CLI_PATH=/home/tameem/.t3/bin/t3 node "$T3CODE_PROJECT_ROOT/scripts/release-thread-devices.mjs"
```

The CLI path above belongs to this machine's desktop installation. Use the CLI matching the running T3 server when registering this script on another machine. The script needs Node.js 22 or later for its built-in WebSocket client. T3 project settings are stored outside Git; enable **Run on settle** for this command in each environment that needs it.

When `projectSettingsFolded` is true, T3 ignores the legacy project `scripts` field returned by `t3_project_read` and updated by `t3_project_update`. Configure the project script override in T3's project settings instead. Programmatic configuration uses `server.updateSettings` with a `patch.projectSettingsOverrides[projectId].defaultProjectScripts` array, preserving other overrides and scripts.

T3 supplies `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH` when the thread settles. The script reads the local server address from `T3CODE_HOME/userdata/server-runtime.json` (`T3CODE_HOME` defaults to `~/.t3`). It obtains a one-minute credential through the T3 CLI with orchestration read/operate scopes and revokes it on exit. Credentials stay in memory.

The script finds exactly one settled, idle, non-subagent thread matching the project and worktree, then calls T3's `device.close` RPC with `shutdown: false`. This releases all devices held by that thread while leaving emulators and simulators running. Missing or ambiguous matches, active runs, authentication failures, and failed RPCs produce a nonzero exit status in the settlement terminal.

To check configuration without releasing devices, run the command with `--dry-run` in the settlement terminal, where the two hook variables are available.

To verify the lifecycle hook, settle an idle worktree thread and inspect its `settle-release-thread-devices-*` terminal for `Released devices for thread ...`. A manual invocation verifies the script but does not verify that T3 selected it on settlement.

## Limits

T3 Code 0.1.8-nightly.20261105.4205 runs settlement scripts only for threads with an existing worktree. Threads using the project checkout directly skip this hook. Supporting them requires a change to T3's settlement lifecycle.

This uses T3's existing HTTP shell snapshot and WebSocket device RPC because this version has no device-close CLI command. A T3 protocol change may require updating the script. Selection and closing are separate requests; T3 does not provide an atomic “close only if still settled” operation.

Run the focused checks with:

```sh
node --test scripts/release-thread-devices.test.mjs
```
