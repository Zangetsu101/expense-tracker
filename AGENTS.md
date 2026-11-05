# Expense Tracker Expo

For intended behavior, read `docs/product.md`. Record new cross-platform implementation decisions separately rather than rewriting historical ADRs.

Read `AGENTS.local.md` if present for machine-specific development setup. Keep host OS, SDK paths, and emulator connection details there rather than in shared instructions.

## Device cleanup

Before finishing a turn that used devices, or settling the thread, release every device opened by this thread with T3's `device_close`, passing its `hostId` and `deviceId` with `shutdown: false`. Leave the emulator or simulator running for reuse. Close only this thread's devices. If cleanup fails, report the device and error in the final response.

## Agent skills

### Issue tracker

Issues and specs live in local markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context repo: read the root glossary and relevant ADRs. See `docs/agents/domain.md`.
