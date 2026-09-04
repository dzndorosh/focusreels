# Executive Summary

**Verdict: READY AFTER CLEANUP.** The committed runtime is compact, typechecks, and its core turn pipeline is substantially tested. It is not a high-risk repository, but it has material documentation/maintenance drift after rapid AI-assisted iterations.

- FACT: main is clean and equals origin/main at 282ea56.
- FACT: the product is a macOS Electron menu-bar utility. IDE adapters emit privacy-minimal events to a private Unix socket; the app shows a YouTube catalog player by default or a local-video overlay.
- FACT: typecheck passed. Test run: 151/163 tests passed. The remaining 12 failed before assertions because this sandbox cannot create Unix sockets (EPERM); this is not evidence of a code regression.
- FACT: README describes an old YouTube Data API/search-queue/local-fallback implementation. The current CatalogProvider loads static bundled/cache/remote catalogs and has no Data API/search/mixer/local fallback.
- FACT: the Open Adapter Protocol code is implemented but its plan remains unchecked.

The highest priorities: correct public documentation, add a socket-capable CI gate, explicitly decide local-player support, test Electron lifecycle boundaries, and sign/notarize release artifacts.

# Current Architecture

## Runtime map

    User / IDE
      -> Cursor / Claude / VS Code hook, external adapter, or Swift AX watcher
      -> NDJSON Unix-domain socket (0600) -> EventBroker -> sanitizeEvent
      -> SourceRegistry admission -> TurnRegistry -> TurnStateMachine per turn
      -> PlayerCoordinator -> YoutubeWindow (default) OR OverlayWindow (local)
      -> preload/contextBridge IPC -> renderer (YouTube IFrame or local media)
      -> close/watchdog/IDE-loss/app-shutdown -> cleanup

Entrypoints: Electron main.ts; CLI emit/demo/headless; shell adapters; optional Swift AX binary. State is settings.json, catalog cache, and feedback under Application Support. Packaging is Electron Builder arm64 DMG.

## Turn state machine

| State | Valid transition | Side effects / recovery |
|---|---|---|
| idle | start -> waiting | arm show-delay + watchdog; unknown progress/end ignored |
| waiting | show timer -> active; end/cancel/watchdog -> ended | fast turn never shows; end cancels timers |
| active | end/cancel/watchdog -> ended; progress ends only in first-response mode | visibility is derived across all active turns |
| ended | none | registry removes entry; late events are dropped |

FACT: state-machine logic is not bypassed by main. TurnRegistry owns timers and ORs visibility. Shutdown cancels turns, destroys both windows, stops watcher/tray/broker and closes E2E server.

Lifecycle gaps:

- MEDIUM/FACT: screen listeners are never removed. Harmless in normal app lifetime, but problematic for in-process teardown/tests.
- MEDIUM/LIKELY: YoutubeWindow's renderer/main morph/drag acknowledgement protocol lacks integration coverage for renderer crash/reload, stale acknowledgements, hide during motion, and rapid player-mode changes.
- LOW/FACT: terminal entries are removed immediately to permit conversation-id reuse. A late start after an end can reopen; this is an explicit trade-off and needs real adapter trace evidence before change.

# Git State

| Check | Result |
|---|---|
| Branch | main...origin/main; no divergence |
| Worktree before report | clean |
| Remote | origin -> GitHub dzndorosh/focusreels |
| Local branches | main, feat/remote-catalog, feat/open-adapter-protocol |
| Remote feature branches | gone; only origin/main remains |
| Tracked ignored files | none |

1. Local-only ignored material: node_modules, dist, release (330 MB), artifacts (21 MB), .DS_Store, local NMT/AI instructions/tools, and candidate/test configs. This is intentional.
2. No high-confidence generated junk is tracked. public/catalog JSON is intentional Pages deployment input. docs/maintenance/codebase-audit.md is stale and should be REVIEWed.
3. FACT: AI sessions had incompatible assumptions. The older audit calls the IFrame player the sole surface and mentions non-existent files; README describes old feed architecture; current code supports two surfaces and remote catalog.
4. No uncommitted important work existed before this requested report.
5. The repository is safe to continue from after reviewing/committing this report.

No secret-like value was found in tracked files. .env is ignored; its content was not inspected.

# Critical Findings

1. **HIGH — Documentation is operationally false.** README claims desktop Data API search/popular requests, quota, a 70/30 mixer and local-clip fallback. CatalogProvider uses static catalog IDs only and always reports demoMode false. This affects privacy, failure and troubleshooting expectations.
2. **HIGH — Release verification is incomplete.** Socket and adapter-hook tests enforce a critical privacy boundary, but no visible general PR/release CI workflow proves them on a socket-capable runner. Package configuration is tested; installed DMG is not.
3. **HIGH — Distribution is unsigned/unnotarized.** package scripts explicitly disable identity discovery. Acceptable for internal testing, not public-release ready.

# Dead / Legacy Code

| Path / item | Finding | Confidence | Action / verification |
|---|---|---:|---|
| overlayWindow.ts, preload.ts, renderer/player.*, mediaLibrary.ts | Local player, reachable via settings.player = local; not dead. | HIGH | KEEP; remove only atomically with setting/docs/IPC tests. |
| Local overlay settings (corner, width, margin, opacity, clickThrough, swipe, volume) | Look old in default YouTube mode but serve local player. | HIGH | KEEP until local mode decision. |
| renderer/wheelGesture.js and .d.ts | Browser-global dependency used by youtube renderer and tests. | MEDIUM | KEEP; make asset contract explicit before cleanup. |
| docs/maintenance/codebase-audit.md | Historical audit with stale file names, claims and TODO. | HIGH | REVIEW/archive/update. |
| Open Adapter Protocol plan | Code complete yet all boxes unchecked. | HIGH | Keep as history only after completion banner/status. |
| Demo-mode vocabulary | Provider always returns false; no true local fallback. | HIGH | REVIEW after deciding desired empty-feed UX. |

# Duplicate / Conflicting Implementations

- FACT: local OverlayWindow and interactive YoutubeWindow are deliberately parallel surfaces behind PlayerCoordinator. They have separate preload/IPC/security/lifecycle semantics.
- FACT: one broker, one source registry, one turn registry and one watchdog route exist. No duplicate state store/event bus was found.
- LIKELY: old queued-player text in README is documentation residue, not live implementation.

# Architecture Drift

Core is coherent. Drift is at the original local overlay, YouTube UI redesign and remote-catalog replacement boundary. Code has a valid policy seam, but documentation never resolves whether local mode is a maintained product feature or contingency. Both windows receive settings changes even when inactive; either surface can silently rot without smoke coverage.

# Documentation Drift

| Claim | Actual implementation | Classification |
|---|---|---|
| README API queries, mostPopular, videos.list, quota/cache/mixer | No runtime Data API; remote/bundled/cache catalog only | FACT |
| README says API failure falls back to clips/Demo mode | Provider returns demoMode false; no such fallback | FACT |
| README says settings only apply next turn | windows apply settings immediately; active player may switch immediately | FACT |
| README says no packaging yet | latest commit/package scripts build DMG | FACT |
| README says 124 tests and names removed feed tests | current run finds 163 tests in 20 files | FACT |
| Old audit names YoutubeCatalogProvider/feedback.ts and one surface | current class is CatalogProvider, files absent, both windows constructed | FACT |

# AI Instruction Drift

AGENTS.md and CLAUDE.md are identical, ignored, local copies of Next Move Theory methodology. They do not conflict, but they are not versioned despite governing AI work; the canon is ignored too. There is no tracked contributor/coding source of truth.

Recommendation: track a short project-specific AGENTS.md or CONTRIBUTING.md; make personal NMT tooling optional rather than sole policy.

# Forgotten / Unfinished Work

| Task / idea | Source | Status | Evidence | Reason / hypothesis |
|---|---|---|---|---|
| Open source IDs and confidence | protocol plan Tasks 1/6 | IMPLEMENTED | events.ts, CLI, protocol doc, commits 928cb16..6dba339 | Checkboxes not maintained |
| Source registry/cap/admission | plan Task 2 | IMPLEMENTED | sourceRegistry, turnRegistry, tray/tests | Same |
| settings.sources migration | plan Task 3 | IMPLEMENTED | coerceSources accepts enabledSources, tests | Same |
| Registry/menu wiring | plan Tasks 4/5 | IMPLEMENTED | main constructs/passes registry; tray lists | Same |
| README/protocol/verification | plan Task 6 | IMPLEMENTED | protocol doc/link/history | Checklist stale |
| Remote catalog first run | remote-catalog design | IMPLEMENTED | catalogUrl, refreshRemote, Pages workflow | External repository config still UNKNOWN |
| Catalog wheel gesture | old audit TODO | IMPLEMENTED, different form | youtube renderer/settings/wheel tests | Old audit stale |
| Signing/notarization | README | NOT IMPLEMENTED | build config/readme | External credentials absent |
| Pages secret/variable setup | design/README | UNKNOWN | Not inspectable from Git | Needs GitHub settings |

# Git Hygiene

.gitignore correctly excludes builds, media, keys, raw artifacts and local tooling. Keep it. Update/archive stale plans/audits. Prune local feature branches only after confirming no desired unmerged work. AUDIT_REPORT.md is now the only intentional audit output.

# Dependencies

Five direct development dependencies (Electron, Electron Builder, TypeScript, Vitest, Node types) are all used; npm ls is clean. Electron in devDependencies is normal for Electron Builder.

- MEDIUM: docs say Node 20+, workflow is Node 22, and scripts use experimental strip-types. No engines policy encodes support.
- LOW: Vitest prints Vite CJS API deprecation. Do not make a CommonJS-to-ESM migration solely to silence it.

# Tests

Strong coverage: sanitizer, state transitions/timers, source policy/settings migration, geometry/springs, catalog provider/ranking, IPC parsers, hooks/installers, package config and catalog commands.

Missing high-value coverage: Electron main/renderer lifecycle; socket suite in CI; signed/package install smoke; remote failure/cache/first run; IFrame unavailable/timeout; local-mode smoke; AX Swift automated test target.

# Security & Privacy

Positive controls: Unix socket is chmod 0600; events rebuilt field-by-field; raw rejected lines not logged; contextIsolation true and nodeIntegration false; popups/navigation denied; renderer feedback parsed; key absent from tracked data.

| Severity | Risk | Action |
|---|---|---|
| HIGH | Privacy/feed docs are inaccurate | Correct before public guarantee |
| MEDIUM | Both windows use sandbox false | Feasibility-test sandbox true |
| MEDIUM | No visible CSP or deny-by-default permission handler | Add after validating YouTube IFrame requirements |
| LOW | Debug flags log video IDs/renderer messages | Keep disabled in release; document retention |
| LOW | Socket override trusts arbitrary environment path | Validate/document trusted local config |

AX claims it reads roles/labels, not chat text; that is statically reviewed, not real-IDE verified.

# Files Cleanup

| File / group | Action | Confidence | Reason |
|---|---|---:|---|
| Local player source/preload/media files | KEEP | HIGH | Reached by supported configuration |
| wheelGesture files | KEEP | MEDIUM | Browser dependency and tests |
| docs/maintenance/codebase-audit.md | REVIEW | HIGH | Stale historical audit |
| protocol implementation plan | REVIEW | HIGH | Completed but unchecked |
| artifacts, release, dist, node_modules, .DS_Store | GITIGNORE | HIGH | Correctly ignored local/generated content |
| public/catalog JSON | KEEP | HIGH | Pages runtime payload |
| editorial config/research pointers | REVIEW | LOW | Not runtime input but intentional product history |

# Recommended Architecture

Keep the current core chain: EventBroker -> sanitize -> SourceRegistry -> TurnRegistry -> PlayerCoordinator. Explicitly decide whether both player modes are supported; then either document/test both or remove local mode atomically. Treat CatalogProvider as the sole feed source and remove stale API terminology. Add a socket/package CI tier and renderer IPC integration tests; do not rewrite the pure core state machine.

# Remediation Plan

## P0 — before further feature work

1. **Truthful documentation.** Files: README, old audit, protocol plan. Replace old API/fallback claims; mark plan complete; archive historical audit. Risk low. Verify every claim against CatalogProvider/main/youtube renderer.
2. **Socket-capable CI.** Files: workflow plus broker/hook tests. Add required normal-runner test job. Risk low. Verify all 163 tests outside sandbox.

## P1 — before public release

1. **Signing/notarization.** Files: package config/release docs. Configure Developer ID and notarization. Risk medium/external. Verify Gatekeeper launch on clean account.
2. **Electron hardening.** Files: both windows/renderer HTML. Test sandbox true; add restrictive CSP/permission handler. Risk medium. Verify IFrame, local player, motion and packaged app.
3. **Lifecycle integration tests.** Test renderer crash/reload, stale acks, hide during motion, display changes/mode switching. Risk low-medium. Verify no orphan window/timer/socket.

## P2 — maintainability

1. Decide local-player policy; test it as supported or remove surface/settings/docs together.
2. Track compact repository AI/coding policy and treat NMT as optional personal tooling.
3. Add engines.node and align docs/CI.

## P3 — cosmetic

Archive stale audit/plan documents and review editorial research/config with product owner.

# Things I Would NOT Change

- The pure TurnStateMachine plus effectful TurnRegistry boundary.
- Immediate terminal-entry removal without real trace evidence of out-of-order starts.
- Unix socket metadata-only protocol and sanitizer.
- Ignoring build outputs, raw artifacts, local media and personal NMT tooling.
- Electron as devDependency for Builder packaging.
- CommonJS output merely to silence a tooling warning.

# Open Questions

1. Are GitHub Pages, YOUTUBE_API_KEY and YOUTUBE_CATALOG_AUTO_PUBLISH configured remotely?
2. Is local-video mode supported product functionality or contingency?
3. What public release/signing channel is intended?
4. Do real adapters emit delayed starts after closes?
5. Is editorial-feeds.json future product work or archive?

# Scores

| Dimension | Score / 10 |
|---|---:|
| Architecture consistency | 7 |
| Code cleanliness | 7 |
| Git hygiene | 8 |
| Documentation consistency | 4 |
| Maintainability | 7 |
| Reliability | 6 |
| Release readiness | 5 |

**Overall: READY AFTER CLEANUP.**
