# The FocusReels adapter protocol

Anything that knows when an AI agent starts and stops working can drive
FocusReels. You do not need to change this app, and you do not need our
permission — write one line of JSON to a socket.

## The socket

`$HOME/Library/Application Support/FocusReels/broker.sock`, mode `0600`.
Newline-delimited JSON, one event per line. Max 8 KB per line. No TCP port
exists, so nothing on the network can reach it.

## The event

```json
{ "source": "aider", "turn_id": "a1b2c3", "event": "turn_started", "confidence": "exact", "timestamp": 1730000000000 }
```

| Field | Required | Shape |
|---|---|---|
| `source` | yes | `[a-z0-9][a-z0-9-]{0,31}` — a stable id for your tool |
| `turn_id` | yes | `[A-Za-z0-9._:-]{1,128}` — opaque; a session or conversation id is ideal |
| `event` | yes | `turn_started` · `turn_progress` · `turn_ended` |
| `outcome` | no — accepted only on `turn_ended` | `completed` · `aborted` · `error` (default `completed`; rejected on any other event) |
| `confidence` | no | `exact` (default) · `heuristic` |
| `timestamp` | no | epoch ms; defaults to arrival |

Every other key is discarded. `sanitizeEvent` rebuilds the event field by field,
so an extra key cannot survive even if you send one.

## Send `turn_progress`. It is not optional in practice.

The app has to answer one question — *is the agent thinking right now?* — and
`turn_started` / `turn_ended` alone answer it badly, because the failure that
matters is a `turn_ended` that never arrives (the agent was interrupted, the
hook host died, the socket blinked). The only defence against that is a timeout,
and a timeout long enough not to cut a legitimately long turn short is far too
long to sit through.

`turn_progress` breaks the trade-off. Send one whenever you have proof the turn
is still alive — a tool ran, a chunk of output landed — and it pushes the
silence timer back (`idleWatchdogMs`, 3 minutes by default). A turn that keeps
its heartbeat can run for as long as the absolute watchdog allows; a turn that
goes quiet is closed in minutes rather than tens of minutes.

In `first-response` hide mode the same event means "the wait is over" and closes
the turn instead. Both readings are the same claim: the agent produced
something.

## Model a pause as an end, then re-open

An agent that stops to ask the human something — a permission prompt, a
question — is **not thinking**, and leaving the overlay up over the exact moment
someone has to read and answer is worse than never showing it at all.

So send `turn_ended` when the agent parks, and a fresh `turn_started` (same
`turn_id` is fine — the key is released the moment a turn ends) when it starts
working again. The bundled hook runtime does this with a marker file; see
`adapters/shared/focusreels-hook.sh`.

## What you must not send

No prompt, no response, no code, no file path, no project name, no window title.
The field shapes are chosen so that content cannot fit through them: a `source`
cannot hold a path, and a `turn_id` cannot hold a sentence. Please keep the
spirit of that, not only the letter.

## `confidence`, and why an honest guess is rewarded

- `exact` — an API told you the turn started. Your source is **enabled on first
  contact** and works immediately.
- `heuristic` — you inferred it from a process, a UI, or a timer. Your source is
  **registered but disabled**, and the user turns it on in the menu bar.

A false window in the middle of someone's work costs more than a missed one, so
the app declines to guess on your behalf. Declaring `heuristic` is what makes
your adapter shippable to people who do not know you.

Confidence is fixed the first time a source is seen. Sending `exact` later does
not upgrade a source that introduced itself as a guess.

## The shortest possible adapter

```sh
emit() {
  printf '{"source":"my-agent","turn_id":"%s","event":"%s"}\n' "$1" "$2" \
    | nc -U "$HOME/Library/Application Support/FocusReels/broker.sock"
}
emit "$SESSION" turn_started
# … your agent runs …
emit "$SESSION" turn_ended
```

Or use the bundled emitter, which needs no Node and no checkout, never fails,
and never prints to stdout — so it is safe to call from a hook whose output the
agent itself reads:

```sh
EMIT="$HOME/Library/Application Support/FocusReels/adapters/generic/focusreels-emit.sh"

sh "$EMIT" my-agent started  "$SESSION"
sh "$EMIT" my-agent progress "$SESSION"   # any sign of life; repeat freely
sh "$EMIT" my-agent paused   "$SESSION"   # parked on a question for the human
sh "$EMIT" my-agent ended    "$SESSION"
```

The `turn-id` argument is optional: omit it and the tool gets a single lane,
which is what a CLI running one request at a time wants.

This is how you wire a tool this project ships no adapter for — Codex, Gemini
CLI, aider, a wrapper of your own. Point its notify/hook/callback mechanism at
the emitter and everything downstream behaves exactly as it does for the
bundled adapters, including the menu-bar switch that appears the first time your
source is seen.

## Rules the app enforces

- A `turn_started` is shown only after the show delay (500 ms by default), so a
  fast answer never flashes a window.
- A turn nobody closes is closed by a watchdog after 10 minutes — or after 3
  minutes of silence, whichever comes first. Heartbeats reset the second one.
- At most 64 distinct sources are ever registered in total, five of which are
  the built-ins — so third-party adapters share a budget of 59. Do not
  generate a fresh `source` per run — that is what `turn_id` is for.
- Switching a source off stops it opening new turns; it never strands a window
  that is already on screen.
