# Expense Tracker Expo

Use ADRs only for decisions with lasting consequences whose rationale would surprise a future maintainer or be hard to recover later. Routine UI choices, implementation details, and test results belong in code, tests, or temporary notes under `.scratch/`. Preserve historical ADRs.

Read `AGENTS.local.md` if present for machine-specific development setup. Keep host OS, SDK paths, and emulator connection details there rather than in shared instructions.

## Agent skills

### Domain docs

Single-context repo: read the root glossary and relevant ADRs. See `docs/agents/domain.md`.

### Scratch folder

`.scratch/` holds local notes, specs and temporary scripts. Git ignores it, but `rg` searches it.
