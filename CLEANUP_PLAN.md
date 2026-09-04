# Cleanup Plan

## Scope

This is a plan only. Do not change runtime code now. Do not remove the local player, change TurnStateMachine or TurnRegistry, perform cosmetic refactors, or upgrade dependencies. A core state change requires a reproducible trace or failing lifecycle test.

## P0

### P0.1 README.md: exact documentation corrections

Files: README.md only.

Replace the YouTube feed material at lines 43-99. Delete claims that the desktop app performs YouTube Data API search, mostPopular, videos.list, query mixing, quota control, 30-minute API caching, background refill, automatic local-clip fallback, Demo mode, or uses feed.test.ts/feedService.test.ts.

Use this replacement content:

> FocusReels does not put a YouTube API key in the desktop app. It starts with the bundled reviewed catalog and asynchronously fetches the published catalog from GitHub Pages. A successful remote result is cached with an ETag. If a remote response fails, is malformed, or times out, the current bundled or cached catalog remains active.
>
> YOUTUBE_API_KEY is used only by maintainer catalog-collection commands and the scheduled GitHub Actions workflow. The installed app does not call the YouTube Data API. The player receives reviewed catalog IDs and categories, never IDE prompts, code, files, project names, or a maintainer key.
>
> CatalogProvider ranks enabled entries using session history, broken-video reports, and locally persisted feedback. It skips entries seen in the current lap and cycles only when eligible entries are exhausted.

Replace Demo mode with: If no eligible catalog entry is available, the YouTube player shows its empty-feed state. It does not switch automatically to local clips. Local clips are a separately selected player mode.

Replace the two-pane claim with: The renderer maintains front and back playback panes so an advance can hand off without rebuilding the visible window. This is catalog playback, not a per-user YouTube API queue.

Replace the hard-coded 124-test line with: npm test runs the current Vitest suite; do not rely on a hard-coded count. It covers core turn logic, event/broker sanitization, source policy/settings, catalog behaviour, geometry, adapters and package configuration.

Replace regionCode description with: ISO-3166-1 alpha-2 retained for catalog/source-policy compatibility; current runtime does not query regional mostPopular.

Replace Known limits feed/quota/packaging bullets with: The feed is a reviewed public catalog, not a personalised recommendation service. There is no sign-in, channel picker, or per-user YouTube Data API request. Freshness depends on scheduled catalog publication; bundled or cached data remains available while remote publication is unavailable. An arm64 DMG can be built but is unsigned and unnotarized. Local clips exist only through the separate local player mode.

Keep the opening Two players statement; it is accurate.

Verification:

    rg -n "search.list|mostPopular|videos.list|70%|30-minute|Demo mode|124 tests|No packaging yet" README.md
    npm run typecheck
    npm test

Run tests on a host that permits Unix sockets.

### P0.2 Stale plans and audits

| File | Decision | Exact change | Verification |
|---|---|---|---|
| docs/superpowers/plans/2026-09-04-open-adapter-protocol.md | MARK COMPLETED | Add Outcome: implemented on main in commits 928cb16 through 6dba339; link protocol/tests; state unchecked procedure boxes are historical. Label ESM/nodenext and Electron 30 historical baseline. | git log for range; typecheck; tests |
| docs/superpowers/specs/2026-09-04-open-adapter-protocol-design.md | MARK COMPLETED | Status becomes implemented; link events, source registry, registry, settings, tray, CLI and protocol; later subsystems not implied complete. | source comparison; tests |
| docs/superpowers/specs/2026-09-04-remote-catalog-design.md | MARK COMPLETED AND UPDATE | Status becomes implemented; cite implementation commits; replace Demo fallback and hard-coded count with empty-feed and bundled snapshot; Pages/secrets/variable are externally UNKNOWN. | catalogProvider tests |
| docs/maintenance/codebase-audit.md | ARCHIVE | Move to docs/maintenance/archive/2026-09-02-codebase-audit.md; prepend Historical snapshot, superseded by AUDIT_REPORT.md. Do not rewrite old claims. | rg inbound refs; git diff --check |
| docs/youtube-catalog-automation.md | UPDATE | Add that maintainer commands create the published catalog and are never run by desktop app; catalog outputs are intentional deployment files. | inspect workflow/collector |
| docs/youtube-shorts-catalog.md | REVIEW | Update only if static-catalog policy; otherwise archive with historical banner, never delete blindly. | source comparison |
| docs/ADAPTER-PROTOCOL.md | KEEP | Current contract; check links only. | typecheck; socket tests |
| SECURITY.md | KEEP, REVIEW | Re-check after README privacy rewrite; edit only if contradiction found. | rg privacy terms |
| docs/research/* and adapter/media READMEs | KEEP | No detected stale implementation plan. Targeted search only. | rg old-feed terms |

Do not delete AUDIT_REPORT.md, public catalog payloads, or editorial config.

### P0.3 Socket-capable CI

Files: add .github/workflows/test.yml. No production-code change.

Trigger on pull requests and pushes to main. Use ubuntu-latest and Node 22. Run npm ci, npm run typecheck, npm test. Do not require YouTube key. Do not skip broker and adapter-hook socket tests because a local audit sandbox lacks AF_UNIX.

Verification:

    npm ci
    npm run typecheck
    npm test

All current tests must pass on GitHub Actions or a normal host.

## P1

### P1.1 Signed/notarized distribution

Expected files: package.json, README.md, new docs/release/macos-distribution.md, and optional release workflow after authorized secrets exist.

Keep pack:mac as unsigned developer build. Add a separate signed release command requiring Developer ID and notarization credentials and failing closed when absent. Never commit credentials or certificates.

Verification:

    npm run build
    npm run pack:mac
    npm run dist:mac:release
    codesign --verify --deep --strict <app-path>
    spctl --assess --type open --context context:primary-signature <app-path>
    xcrun stapler validate <app-path>

### P1.2 Electron hardening

Expected files: src/app/youtubeWindow.ts, src/app/overlayWindow.ts, src/app/main.ts, src/app/renderer/youtube.html, src/app/renderer/player.html, and a focused security configuration test.

Prove sandbox true works before enabling it. Add deny-by-default permission handlers and narrow CSPs allowing bundled assets and exact YouTube iframe origins. Preserve contextIsolation, disabled nodeIntegration, popup denial and navigation denial.

Verification: npm run typecheck; npm test; npm run build; npm start. Manual macOS smoke: playback, next/previous/mute, drag, collapse/expand, local mode with clips, switch back, quit/socket removal; repeat packaged.

### P1.3 Lifecycle integration coverage

Expected files: add tests/YoutubeWindow.integration.test.ts or tests/appLifecycle.test.ts plus fixtures/fakes. Touch youtubeWindow.ts or main.ts only for a narrow test seam.

Cover hide during morph/drag/snap; renderer reload/crash around acknowledgements; stale transition acknowledgement; display removal; player switch during active turn; quit during animation/open broker client; remote failure preserving catalog.

Verification: npm run typecheck; npm test. Use real Electron or a complete BrowserWindow/webContents fake; private-method tests alone are insufficient.

## P2

### P2.1 Local player decision gate

No deletion now. Product owner chooses either supported mode or deprecated mode.

If supported: clarify it is manually selected, group local-only README settings, add fixture-media smoke test and packaged-app checklist.

If deprecated: add README notice and docs/decisions/local-player-deprecation.md with version/migration/removal criteria, but retain code/settings until a future approved atomic migration.

Future removal, if approved, must jointly cover OverlayWindow, preload/player renderer, media IPC, settings, tray option, assets, docs, tests and migration.

Verification: npm run typecheck; npm test; npm start. Manual: select local player, run long simulated turn, check media/hide, switch to YouTube.

### P2.2 Portable coding-agent policy

Files: .gitignore; new tracked AGENTS.md or CONTRIBUTING.md; optional docs/development/ai-tooling.md.

Replace ignored personal methodology instructions with compact tracked repository rules: commands, safety, tests, documentation source of truth, optional NMT statement. Remove only AGENTS.md from ignore after replacement exists; keep CLAUDE/NMT personal material ignored.

Verification: git check-ignore -v AGENTS.md CLAUDE.md; git status --short; npm run typecheck.

### P2.3 Supported Node version

Files: package.json, README.md, new P0 test workflow, and catalog workflow only if shared policy chosen.

Add engines.node, recommended >=22 <23, matching workflow and experimental strip-types use. Do not update packages.

Verification: node --version; npm ci; npm run typecheck; npm test.

## Explicit non-actions

| Item | Reason |
|---|---|
| TurnStateMachine / TurnRegistry | No demonstrated correctness failure. |
| Local-player removal | Reachable configuration; product decision required. |
| Region/local settings removal | Coupled to local-player decision. |
| Dependency upgrades | No defect requiring them. |
| Cosmetic cleanup | Outside audit remediation. |
| Research/config deletion | Product-owner decision. |

## Completion criteria

1. README has no desktop Data API, per-user quota/cache, local fallback, or no-packaging claim.
2. Historical plans/specs are completed or archived.
3. Socket/hook suite passes in ordinary CI.
4. Local-player status is recorded without deletion.
5. No core transition or dependency change is introduced without separate work.
