# Open adapter protocol

**Status:** design, approved for planning
**Scope:** subsystem 1 of 4 (open protocol → diagnostics → universal CLI sensor → native/web)

## Problem

FocusReels can only be driven by four hard-coded sources. `SourceId` is a closed
union in `src/core/events.ts`, `sanitizeEvent` rejects anything outside it, and
`enabledSources` is a `Record<SourceId, boolean>` reproduced in three more files.
A user running Aider, Codex CLI, a company-internal agent, or an agent that does
not exist yet cannot connect it without forking the app.

Every other coverage subsystem is blocked on this: a universal CLI sensor and an
AX profile for a native app both need to announce a source the app has never
heard of.

A second problem rides along. The four current sources are all *exact* — they
report a turn because an API told them so. Everything we add next is
*heuristic*: it infers a turn from a process tree or a UI. The app has no way to
tell the two apart, and therefore no way to honour the product rule that a
heuristic must never open the window on its own.

## Goals

1. Any tool can drive FocusReels by writing one line of JSON to the socket, with
   no change to this codebase.
2. An adapter can declare that its signal is a guess, and a guess never opens
   the window until the user allows that source.
3. A source the app has never seen becomes visible and controllable in the menu
   bar rather than silently working or silently not working.
4. The privacy invariant is unchanged: an event carries metadata only, and
   `sanitizeEvent` remains the single choke point.

## Non-goals

- No new sensors. This subsystem ships no adapter; it makes adapters possible.
- No protocol version field. The protocol evolves by adding optional fields, and
  the whitelist in `sanitizeEvent` makes that safe in both directions. A version
  number would only matter for a breaking change, which we cannot make to
  third-party adapters anyway.
- No network transport. The Unix socket with mode `0600` stays the only door.

## Design

### 1. `source` becomes an open, shaped id

```ts
const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
```

Lowercase kebab, 1–32 chars. This is deliberately narrower than `turn_id`: a
source id is a stable machine handle, so it has no room for a path, a project
name, or a sentence. `Aider — /Users/ivan/work` fails the regex; `aider` passes.

`SOURCES` stays, renamed in meaning to `BUILTIN_SOURCES`, and is used only for
labels and defaults — never for validation.

`TurnEvent.source` becomes `string`. `SourceId` is kept as an alias of `string`
so the diff stays readable, with the union preserved as `BuiltinSourceId` for
the places that legitimately switch on a known source (tray labels, process
hints).

### 2. `confidence` — an adapter declares how much it knows

```ts
confidence: 'exact' | 'heuristic'
```

Optional on the wire. Absent means `'exact'`, which keeps today's four adapters
behaving exactly as they do now. A sensor that infers turns is expected to
declare `heuristic` — we cannot enforce honesty, and do not try to; the field
exists so an honest sensor can be treated correctly.

Confidence is a property of the *source*, not of the individual event. The first
event from a source records its confidence; later events from that source do not
change it. This keeps the trust decision stable — a source cannot start out
`exact` to get enabled and then switch.

### 3. Source registry: policy on disk, liveness in memory

`settings.enabledSources` is replaced by:

```jsonc
"sources": {
  "claude-code": { "enabled": true,  "confidence": "exact" },
  "aider":       { "enabled": true,  "confidence": "exact" },
  "chatgpt-app": { "enabled": false, "confidence": "heuristic" }
}
```

**Admission rule when an unknown source first appears:**

| Declared confidence | Recorded as | Rationale |
|---|---|---|
| `exact` (or absent) | `enabled: true` | The adapter was deliberately installed and claims to know. Making it silent-by-default reproduces the "installed it, nothing happened" failure we are trying to remove. |
| `heuristic` | `enabled: false` | A guess never opens the window until the user opts in. |

Registration happens on **any** event from an unknown source, not only
`turn_started` — a source whose very first observed event is a `turn_ended`
should still appear in the menu, so the user can see it exists.

The disabled-heuristic case must not be silent. `SourceRegistry` counts the drop
per source (`droppedWhileDisabled`) and `TurnRegistry` gains an
`onSourceBlocked(source, reason)` callback alongside its existing
`onVisibilityChange` / `onTurnChange`. `main.ts` wires it to a tray refresh, so
the menu can read `chatgpt-app — blocked (guess)`. Subsystem 2's doctor reads
the same counters.

**Liveness** — `lastSeenAt`, event counts, dropped counts — lives in an
in-memory `SourceRegistry`, never in settings.json. Writing settings on every
event would mean a disk write per turn and would fight hand-editing. This
in-memory registry is also the data subsystem 2 (`focusreels doctor`) reads.

**Cap:** at most 64 registered sources. A misbehaving adapter that emits a fresh
random id per event must not grow settings.json without bound. Past the cap, new
ids are rejected with a counted reason and nothing is written.

### 4. Migration

`coerce()` in `settings.ts` reads the old `enabledSources` object when `sources`
is absent and rewrites it into the new shape, preserving each flag and marking
every migrated entry `confidence: 'exact'`. The old key is then dropped. A
hand-edited file containing both wins on `sources`.

This is an intentional behaviour change to an existing tested rule:
`tests/settings.test.ts:53` currently asserts that an unknown key (`hacker`) is
stripped from `enabledSources`. Under the new model an unknown key is exactly
what a third-party adapter looks like, so it is kept when it passes
`SOURCE_ID_RE` and dropped when it does not. That test is rewritten rather than
deleted, so the new rule stays pinned.

### 5. Menu bar

`Sources` submenu is built from the union of built-ins and registered sources,
not from a constant. Built-ins keep their friendly labels; an unknown source
shows its raw id, which is safe to display precisely because the regex forbids
anything prose-shaped. A heuristic source is labelled `aider (guess)` so the
user knows why it may be off.

### 6. `focusreels-emit`

`--source` is validated against `SOURCE_ID_RE` instead of the enum, and gains
`--confidence exact|heuristic`. An invalid source still exits 0 — the contract
with the IDE is unchanged — but writes one line to stderr so an adapter author
sees the reason.

### 7. `ADAPTER-PROTOCOL.md`

A short public document: the five-plus-one fields, the socket path, the regexes,
the admission rule, a copy-pasteable shell one-liner, and the privacy promise an
adapter is expected to keep. This is the artefact that closes the long tail —
someone else writes the adapter for the tool we have never heard of.

## Blast radius

| File | Change |
|---|---|
| `src/core/events.ts` | open `source`, add `confidence`, keep `BUILTIN_SOURCES` |
| `src/core/sourceRegistry.ts` | new — admission, liveness, cap |
| `src/core/turnRegistry.ts` | consult the registry instead of `enabledSources`; report blocked sources |
| `src/app/settings.ts` | `sources` shape + migration from `enabledSources` |
| `src/app/tray.ts` | dynamic submenu, `(guess)` suffix |
| `src/app/ideWatcher.ts` | hints keyed by built-in id; unknown sources simply have none |
| `src/cli/emit.ts` | regex validation, `--confidence` |
| `src/cli/demo.ts` | typing only |
| `tests/events.test.ts` | open-source acceptance, shape rejection, confidence |
| `tests/settings.test.ts` | migration; rewritten unknown-key rule |
| `tests/turnRegistry.test.ts` | heuristic blocked by default, exact admitted |
| `tests/sourceRegistry.test.ts` | new |
| `docs/ADAPTER-PROTOCOL.md` | new |

## Testing

Pure-core changes stay covered by the existing vitest suite; no Electron needed
for any of the above except the tray, which is left uncovered as it is today.

Cases that must be pinned:

- an unknown well-shaped source is accepted and admitted enabled
- an unknown source declaring `heuristic` is admitted **disabled**, and its
  `turn_started` opens no turn
- the same source cannot upgrade its own confidence on a later event
- `Source With Spaces`, `../etc/passwd`, a 200-char id, and an uppercase id are
  all rejected
- the 65th distinct source is rejected and settings.json is not written
- an old settings.json with `enabledSources` migrates flag-for-flag
- `confidence` absent behaves identically to `exact` (regression guard for the
  four shipped adapters)

## Risks

**A third-party adapter lies about confidence.** Unfixable by design; the field
is a courtesy, not a permission check. Mitigated by the fact that the user can
switch any source off in one click, and by subsystem 2 making it visible which
source opened a turn.

**Displaying an unknown id in the menu bar.** The regex is the whole defence, so
it must stay narrow. Any future widening of `SOURCE_ID_RE` re-opens this.

**Migration runs against a hand-edited file.** `coerce()` already treats the file
as untrusted input and falls back per field; the migration follows the same rule
rather than throwing.
