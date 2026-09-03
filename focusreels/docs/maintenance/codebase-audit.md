# FocusReels codebase audit

Audit baseline: 2026-09-02. Before cleanup, `npm test -- --run` passed 132 tests in
11 files; `npm run typecheck`, `npm run build`, and `npm run check:key` also passed.

## Production flow

`config/youtube-sources.json` is the maintainer allowlist and `catalog-youtube-collect.ts`
produces the validated Pages catalog. `YoutubeCatalogProvider` is the runtime source of
truth: it selects environment/test input only in development, otherwise remote catalog,
cache, or fixture; it owns validation, ETag/cache refresh, ranking, seen/broken history,
and feedback persistence. The renderer owns one official IFrame Player instance. Overlay
movement and morphing remain in `YoutubeWindow` and are independent of catalog selection.

## File map and decisions

| Area | Current role / callers | Decision |
| --- | --- | --- |
| `src/app/{main,youtubeWindow,youtubePreload,renderer}` | Electron runtime, IPC, one local IFrame player; loaded by `src/app/main.ts` | **KEEP**. UI and motion are out of scope. |
| `src/youtube/catalog.ts`, `catalogProvider.ts`, `feedback.ts`, `reviewDataset.ts` | Runtime catalog, validation, ranking, persistence; imported by app/tests | **KEEP**. This is the single runtime source of truth. |
| `scripts/catalog-youtube-collect.ts`, `catalog-youtube-candidates.ts`, `catalog-youtube-seed.ts`, `catalog-youtube-test-collect.ts`, `catalog-youtube-review.ts`, `youtube-e2e-driver.ts` | Maintainer bootstrap/collection/review and development E2E; invoked by package scripts | **KEEP**. These are intentionally outside the Electron build. |
| `scripts/catalog-youtube-sync.ts` | Older playlist-ID collector; no production import or workflow reference | **DELETE** after removing its npm script. `catalog-youtube-collect.ts` is the only collector path. |
| `src/youtube/{service,api,feed}.ts` | Legacy FeedService and search mixer were imported only by implementation-specific regression tests; no production import, IPC or workflow reference | **DELETE**. Provider behavior is covered through `YoutubeCatalogProvider` tests; no adapter seam remains. |
| `src/app/youtubeWindow.ts` native `WebContentsView` Shorts block | `createYoutubeShortsView` had no caller; no active IPC sender/receiver or workflow contract | **DELETE**. The only playback surface is the local IFrame player. |
| `src/app/renderer/youtube.js` playlist player block | `ensurePlaylistPlayer` was never called and its wheel/click handlers could not affect catalog panes | **DELETE**. Shared `loadYouTubeApi` remains for the pane-based player. |
| `scripts/bluesky-content-probe.ts`, `editorial-*.ts` | One-off research; no runtime/workflow imports | **DELETE**. Their aggregate findings are preserved in `docs/research/bluesky-source-evaluation.md`; no caller or reproducible production test depends on them. |
| `docs/research/bluesky-*`, `focusreels-editorial-feed.md` | Research reports; one report is a duplicate/expanded version | **KEEP one canonical report**, leave a short pointer from older names. |
| `artifacts/bluesky-probe`, `artifacts/editorial-feed`, `artifacts/youtube-catalog` | Generated raw responses, checkpoints, galleries, local reviews and diagnostics | **GITIGNORE**; retain only small aggregate summaries when useful. They are not runtime inputs. |
| `public/catalog/youtube-catalog.json`, `status.json` | Committed Pages publication payload | **KEEP**; these are canonical generated outputs for deployment, not local artifacts. |
| `public/catalog/review.html` | Maintainer-only static review tool, not loaded by Electron | **REFACTOR** into HTML/CSS/JS files. |

## Development flow

Seed IDs → candidate channels → candidate review gallery → development test allowlist →
test catalog → `e2e:youtube`. Candidate and test files never feed production unless a
maintainer explicitly copies reviewed channels into the active allowlist.

## Legacy reachability evidence

Before deletion, `rg` found no call to `createYoutubeShortsView`, no production import of
`FeedService`, no active native-view IPC consumer, and no workflow reference to the old
sync script. The implementation-only tests were removed with the dead modules. No source
imports `hls.js`.

## Generated-file policy

Raw probes, checkpoints, galleries, temporary E2E profiles, candidate exports and test
catalogs are local evidence and are ignored. Small aggregate research reports remain in
`docs/research`; the empty Pages catalog remains tracked so a deployment has an explicit,
valid fail-closed payload.

## Module boundaries after cleanup

Runtime callers use `YoutubeCatalogProvider` and do not know cache/filesystem details.
Maintainer commands use the catalog collector and its validation contract. The remaining
legacy FeedService is explicitly test-only; no second production playback path is enabled.

TODO: `Catalog scroll/swipe gesture requires a separate UI iteration.`

Post-cleanup YouTube E2E smoke (2026-09-02): environment catalog loaded 8 IDs; all 8
were selected, 7 reached `player-playing` in the sequential driver run and the first
reached `player-playing` in a controlled hold-open run; no player errors or empty-layer
regression was observed.

The project keeps CommonJS TypeScript output. The `node --experimental-strip-types` scripts
may emit Node's module-type warning; adding `"type": "module"` would be a whole-project
migration and is intentionally not part of this cleanup.
