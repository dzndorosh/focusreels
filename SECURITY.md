# Security

## Reporting a vulnerability

Open a [private security advisory](https://github.com/dzndorosh/focusreels/security/advisories/new)
rather than a public issue. Expect a first reply within a week.

## What this project promises

FocusReels sits between your IDE and a video player while an AI agent works, so
two properties matter more than anything else here.

**An adapter may send metadata and nothing else.** Six fields — `source`,
`turn_id`, `event`, `outcome`, `confidence`, `timestamp` — and no prompt, no
response, no code, no file path, no project name, no window title.
`sanitizeEvent` in `src/core/events.ts` is the single choke point: it rebuilds
every event field by field, so an extra key cannot survive even if an adapter
sends one. The field shapes are chosen so content cannot fit through them — a
`source` cannot hold a path, a `turn_id` cannot hold a sentence. Rejected lines
are counted, never logged, because the offending line is exactly the thing that
might carry content.

**Nothing listens on the network.** The broker binds a Unix domain socket with
mode `0600` under your Application Support directory. No TCP port is opened.

A YouTube API key, when present, is read in the main process only. The renderer
reaches it through nothing: its entire view of the world is a `contextBridge`
preload exposing finished video objects. `npm run build` fails if anything
shaped like a key appears in a renderer asset.

## Trust boundary

Any process running as your user can write to the socket, exactly as it could
before — this is not a privilege boundary and does not try to be one. What such
a process can do is open or close a turn, which shows or hides a video window.
Third-party sources are capped at 64 registrations, and the menu bar's
**Forget third-party sources** clears them.

## Scope

Out of scope: anything requiring an attacker to already run code as your user
beyond the socket surface described above; the content YouTube serves; and
third-party adapters not shipped in `adapters/`.
