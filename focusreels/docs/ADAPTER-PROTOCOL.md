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

Or use the bundled CLI, which never fails and never prints to stdout:

```sh
node /path/to/focusreels/dist/cli/emit.js \
  --source my-agent --event turn_started --turn-id "$SESSION"
```

## Rules the app enforces

- A `turn_started` is shown only after the show delay (500 ms by default), so a
  fast answer never flashes a window.
- A turn nobody closes is closed by a watchdog after 10 minutes.
- At most 64 distinct sources are ever registered. Do not generate a fresh
  `source` per run — that is what `turn_id` is for.
- Switching a source off stops it opening new turns; it never strands a window
  that is already on screen.
