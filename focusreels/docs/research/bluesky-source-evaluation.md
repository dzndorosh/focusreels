# Bluesky source evaluation

**Decision: `REJECTED_AS_PRIMARY_SOURCE`**

Bluesky was evaluated as a possible anonymous short-video provider using only public
AppView XRPC endpoints. The probe handled both `app.bsky.embed.video#view` and nested
`app.bsky.embed.recordWithMedia#view`, extracted public HLS playlists/thumbnails, applied
portrait filtering and moderation labels, and sampled feed generators plus search results.

## Evidence

The final aggregate snapshot recorded 317 normalized videos, 140 strong-portrait items,
88 authors, 21 moderation exclusions and an English-heavy language distribution. The
technical sample had 50/50 HLS manifests and thumbnails available without Authorization,
Referer or Origin. This establishes technical feasibility, not product suitability.

Content evidence remained insufficient and inconsistent: exploratory feed/search runs
did not establish a stable seven-day supply, duration coverage was incomplete, and the
manual entertainment-quality gate was not met. Editorial classification left a large
`unknown` class and no source passed the required safety, diversity and quality checks.
Political/adult feeds were explicitly excluded. `langs` provides language tags, not
geographic personalization.

## Reusable findings

Public HLS can be checked without downloading media segments; moderation labels must be
applied before anonymous display; feed overlap and author concentration need measuring;
and a source should be validated as a catalog, not trusted because its name contains
“video”. These findings inform future provider research but are not a runtime dependency.

Detailed raw responses, checkpoints and HTML galleries are intentionally not part of the
production repository. Historical aggregates remain in `artifacts` locally when available;
the canonical decision and methodology are this document.
