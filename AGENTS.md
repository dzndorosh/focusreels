# FocusReels Agent Guide

## Architecture

The canonical runtime chain is:

```text
IDE / adapter
  → Unix socket
  → EventBroker
  → sanitizeEvent
  → SourceRegistry
  → TurnRegistry
  → TurnStateMachine
  → PlayerCoordinator
  → YouTube or local player surface
```

Treat this as the high-level architecture unless an intentional, evidence-backed
change explicitly replaces it.

## Sources of truth

- Runtime behaviour: source code and tests.
- Public product behaviour: [README.md](README.md).
- Adapter contract: [docs/ADAPTER-PROTOCOL.md](docs/ADAPTER-PROTOCOL.md).
- [AUDIT_REPORT.md](AUDIT_REPORT.md) and archived historical documents are
  remediation/history references, not live implementation specifications.
- [CLEANUP_PLAN.md](CLEANUP_PLAN.md) is remediation history, not a permanent
  runtime specification.

## Safe change rules

- Do not bypass `TurnStateMachine` or `TurnRegistry` for turn lifecycle logic.
- Do not add a parallel event bus, state registry, or watchdog without an
  explicit architectural reason.
- Do not delete apparently unused files before checking imports, dynamic/runtime
  references, Electron preload/main/renderer connections, and build scripts.
- Do not remove local-player components unless an approved atomic migration
  covers their code, settings, IPC, assets, tests, and documentation.
- Do not modify tests merely to make a failing implementation pass.
- Do not introduce secrets or API keys into the desktop runtime.
- Do not add YouTube Data API calls to the installed app without an explicit
  product architecture change.
- Do not mix broad cosmetic refactors with functional work.
- Do not update dependencies unless the task requires it.

## Verification

For a clean environment:

```bash
npm ci
npm run typecheck
npm test
```

When dependencies are already installed:

```bash
npm run typecheck
npm test
```

Before finishing, also run:

```bash
git diff --check
```

## Git and documentation discipline

- Keep commits scoped. Do not mix documentation, runtime refactors, dependency
  upgrades, and unrelated cleanup.
- Inspect `git diff` before committing.
- Do not amend previous commits or push unless explicitly requested.
- When runtime behaviour changes, update README and relevant docs in the same
  logical change.
- Mark completed plans/specifications as implemented or superseded; preserve
  historical context instead of silently rewriting it.

## Privacy and security invariants

Preserve the metadata-minimal adapter protocol, the sanitizer boundary, and the
local/private Unix-socket behaviour. Keep `contextIsolation` enabled,
`nodeIntegration` disabled, and popup/navigation restrictions in place. Do not
make stronger privacy claims than code and tests prove.

## Local tooling

Personal `CLAUDE.md`, Next Move Theory, and superpowers workflow files may exist
locally. They are optional tooling, not repository source of truth. This
repository-level AGENTS.md overrides them when instructions conflict.

## Change standard

Require FACT-level evidence before structural changes. A core state/lifecycle
architecture change needs at least one of:

- a reproducible trace;
- a failing test;
- a documented product requirement; or
- an explicit architectural decision.
