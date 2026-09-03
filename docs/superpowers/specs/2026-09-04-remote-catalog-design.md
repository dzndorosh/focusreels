# Remote catalog: a first run that works without an API key

**Status:** design, approved for planning
**Scope:** subsystem A of the packaging effort (A: catalog without a key → B: adapter install without Node → C: `.app` and DMG)

## Problem

A new user installs FocusReels and gets nothing. The catalog collector needs a
YouTube Data API key, but that key belongs to the maintainer and cannot be
present on a fresh user's machine. Requiring every person trying a video overlay
to make their own Google Cloud project would defeat the product.

The machinery to avoid this is already written and never switched on:

- `CatalogProvider.refreshRemote(url)` fetches a published catalog with `ETag`
  revalidation, writes an atomic cache, and fails soft on any error.
- `.github/workflows/youtube-catalog.yml` already collects a catalog with a
  `YOUTUBE_API_KEY` secret and uploads it as a Pages artifact.
- A 448-video catalog is committed at `config/youtube-catalog.json`.

Three things stop it working. The URL comes only from
`process.env.FOCUSREELS_REMOTE_CATALOG_URL` (`main.ts:279`), which a packaged
`.app` can never have. Pages is not enabled and the secret is not set, so
nothing is published. And the workflow's `deploy` job is gated on
`github.event_name == 'workflow_dispatch'`, so the daily schedule collects a
catalog and then throws it away.

A fourth problem is adjacent and belongs here, because this subsystem exists to
make the app's state legible: **the menu bar lies about the feed.** `main.ts:131`
passes a hard-coded `{ demoMode: false, reason: null, queued: 0 }`, so the tray
says `Feed: 0 queued` forever, whatever is actually loaded, while
`CatalogProvider.status` has the real numbers.

## Goals

1. A user who installs the app and never obtains a key gets a working feed.
2. The catalog stays fresh without anyone doing anything — dead and
   non-embeddable videos wash out on their own.
3. The menu bar reports what is actually loaded, and where it came from.
4. No key of the maintainer's ever reaches a user's machine or the repository.

## Non-goals

- No periodic in-app refresh timer. Refresh at startup plus the existing
  **Refresh feed** menu item is enough; a background timer is an extra moving
  part nobody asked for.
- No in-app use of `YOUTUBE_API_KEY`. The desktop app has no runtime YouTube
  Data API collector; that key belongs only to the maintainer's catalog
  commands and GitHub Actions secret. A developer can still point a build at a
  different finished catalog with `FOCUSREELS_REMOTE_CATALOG_URL`.
- No new hosting infrastructure. If GitHub cannot host it, that is a separate
  decision, not this subsystem.

## Design

### 1. Where the catalog lives

**GitHub Pages**, at
`https://dzndorosh.github.io/focusreels/catalog/youtube-catalog.json`.

The workflow already targets Pages, `refreshRemote` already speaks `ETag`, and
Pages is a real CDN, so a daily-changing 84 KB file costs nothing and
revalidates with a `304` for every user who already has it.

Rejected: `raw.githubusercontent.com` (GitHub asks that it not be used as a CDN,
its ~5-minute cache is outside our control, and the URL is pinned to a branch
name), and a Release asset (a stable URL, but updating it means cutting a
release, which kills the daily cadence).

**This couples the subsystem to publishing the repository:** Pages on a private
repository requires a paid plan. The repository is already prepared to be made
public; if that decision reverses, this design needs a different host.

### 2. `catalogUrl()` — one pure function

New module `src/youtube/catalogUrl.ts`:

```ts
export const DEFAULT_CATALOG_URL =
  'https://dzndorosh.github.io/focusreels/catalog/youtube-catalog.json';

export function catalogUrl(env: NodeJS.ProcessEnv = process.env): string
```

Returns `FOCUSREELS_REMOTE_CATALOG_URL` when it is set and non-empty, otherwise
the compiled default. A whole module for four lines is justified because this is
the only new logic in the subsystem that can hold a bug, and it takes the
environment as an argument so a test can drive it without mutating `process.env`.

`main.ts:279` becomes `void catalogProvider.refreshRemote(catalogUrl())`.

An empty-string override means "use the default", not "fetch nothing" — an empty
env var is how a shell hands over an unset variable, and treating it as a
deliberate opt-out would silently disable the feed.

### 3. The menu bar stops lying

`main.ts` passes `feedStatus: () => catalogProvider.status` instead of the stub.

`TrayDeps.feedStatus` widens from the three-field inline type to the existing
`FeedStatus` from `src/youtube/types.ts`, which already carries `provider`,
`catalogSource`, `totalVideos` and `playableVideos`.

The tray's feed line becomes, in order of what it knows:

- `Feed: 412 of 448 · published 6h ago` when the catalog came from `remote`
- `Feed: 412 of 448 · bundled snapshot` for any local source (`cache`,
  `development-file`, `fixture`, `environment`)
- `Demo mode · <reason>` unchanged when `demoMode` is set

The age comes from the catalog's own `generatedAt`, which every catalog carries
and which `status` must therefore start exposing as `generatedAt`.

### 4. The workflow actually publishes

Two changes to `.github/workflows/youtube-catalog.yml`:

- The `deploy` job's condition loses `github.event_name == 'workflow_dispatch'`
  so the daily schedule publishes too, keeping the `YOUTUBE_CATALOG_AUTO_PUBLISH`
  variable as the on/off switch.
- `npm test` moves *before* the Pages artifact upload, so a catalog that breaks
  the suite is never published. Today the upload happens first.

### 5. Repository setup (not code)

Done by the maintainer, documented in the README:

1. Make the repository public (required for free Pages).
2. Settings → Pages → source: GitHub Actions.
3. Settings → Secrets → `YOUTUBE_API_KEY`.
4. Settings → Variables → `YOUTUBE_CATALOG_AUTO_PUBLISH = true`.
5. Run the workflow once manually and confirm the URL serves JSON.

The key stays in GitHub Secrets and on the maintainer's machine. It is never
committed, never shipped, and never sent to a user — a user's app only ever
fetches a finished JSON file.

## Failure modes

| Situation | What the user gets |
|---|---|
| Offline, or Pages down | The bundled 448-video catalog. `refreshRemote` times out at 4 s and returns false; the runtime catalog is untouched. |
| Catalog fetched once, then offline | The atomic on-disk cache from the last fetch. |
| Published catalog is malformed | `fetchRemoteCatalog` rejects it and returns no catalog; the previous one stands. |
| Every video in the catalog is dead | Playable count drops to zero and the app falls to Demo mode with its existing reason string. The daily refresh is what stops this accumulating. |
| Developer needs a different catalog | Set `FOCUSREELS_REMOTE_CATALOG_URL` to an HTTPS published catalog. |

## Testing

- `catalogUrl()`: the override wins; an empty or whitespace override falls back
  to the default; the default is returned when the variable is absent.
- The default URL is a syntactically valid `https` URL — a typo here breaks
  every install and nothing else would catch it.
- Existing `catalogProvider.test.ts` already covers `refreshRemote`'s soft
  failure and cache write; no new cases needed there.
- The tray and `main.ts` remain uncovered, as they are today.

## Risks

**The bundled catalog rots between releases.** It is the floor, not the ceiling —
a user who is never online gets a snapshot that ages. Accepted: the alternative
is shipping nothing when offline.

**One maintainer's quota backs every user's feed.** The workflow spends the
quota once per day regardless of how many users there are, which is precisely
why this design scales where "every user brings a key" does not.

**Publishing a curated list of third-party video IDs.** The catalog is public
metadata — ids, titles, channel names — and the pipeline already filters to
public, embeddable, non-live videos under 180 s.
