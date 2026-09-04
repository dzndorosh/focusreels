# Automated YouTube catalog

These maintainer commands create the published catalog; they are never run by
the desktop app. `config/youtube-catalog.json` and the payloads under
`public/catalog/` are intentional generated deployment outputs, not
per-user runtime collection artifacts.

The desktop app contains no YouTube API key. A maintainer creates `config/youtube-sources.json` with manually reviewed `UC...` channel IDs, category, weight and per-channel limit. Keep the example allowlist empty until channels have been reviewed.

For the initial bootstrap, set `YOUTUBE_API_KEY` only in the maintainer shell and run `npm run catalog:youtube:seed`. It performs one batched `videos.list` request for the eight known smoke-test IDs and writes `artifacts/youtube-catalog/seed-channels.json` plus disabled `config/youtube-sources.candidates.json`. Review recent uploads in `public/catalog/review.html`; only then copy approved channels into the active allowlist.

Run a local dry-run with `YOUTUBE_API_KEY=... npm run catalog:youtube:collect`. The collector uses `channels.list`, `playlistItems.list`, and `videos.list`; it rejects private, live, non-embeddable, blocked, too short/long, and stale videos. It writes `config/youtube-catalog.json` and the Pages payload under `public/catalog/` atomically. An empty allowlist, API error, invalid response, empty result, or >50% drop fails closed and preserves the prior catalog.

Add permanent removals to `config/youtube-video-blocklist.json`. Set a source's `enabled` to `false` to pause a channel. Review `public/catalog/youtube-catalog.json` with the existing embedded-player tooling before setting repository variable `YOUTUBE_CATALOG_AUTO_PUBLISH=true`.

The workflow is manual or daily. It reads the `YOUTUBE_API_KEY` Actions secret, never serializes it, uploads diagnostics, and only deploys Pages when the repository variable is enabled. The repository owner/name must be taken from `git remote -v`; no URL is hard-coded here. The app ships with the project's HTTPS Pages URL; `FOCUSREELS_REMOTE_CATALOG_URL` is only an optional override for a developer build. Runtime accepts only HTTPS, rejects redirects, limits response size, and falls back to cache/fixture.

The public user needs no key or setup. YouTube branding and player notices remain subject to the official iframe API.

## Permanent channel bootstrap

Maintainers may keep candidate handles in `config/youtube-channel-handles.json`. Resolve
and inspect them with `YOUTUBE_API_KEY=... npm run catalog:youtube:resolve-handles`; this
writes only `artifacts/youtube-catalog/resolved-channels.json` and
`permanent-candidates*.json`. Then decide, either way:

- **Manual** — review the `Permanent candidates` mode in the local gallery and export
  `permanent-channel-review.json`.
- **Automatic** — `npm run catalog:youtube:auto-approve` writes the same review file with
  no key and no browser: a channel is approved when at least `MIN_ELIGIBLE` (default 3) of
  its ten most recent uploads pass the eligibility check. It carries the current allowlist
  through as approved, because `apply` replaces `sources` wholesale and would otherwise
  drop every channel absent from the review file. It fails closed when nothing reaches the
  threshold.

Then run `YOUTUBE_API_KEY=... npm run catalog:youtube:apply-review`. The command is fail-closed,
backs up the prior allowlist in local artifacts, and never writes a production catalog.
