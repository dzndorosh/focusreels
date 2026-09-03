# Accessibility adapter (`focusreels-ax`)

A small Swift binary for the IDEs that have no hook API — **JetBrains AI
Assistant** — and as the **fallback for VS Code** when Agent Hooks are turned off
by organisation policy.

It watches the chat UI's controls and reports turn boundaries as the same
five-field metadata every other adapter sends.

## What it reads, and what it refuses to read

| Reads | Never reads |
|---|---|
| `AXRole` of nodes while walking the window tree | any `AXValue` |
| `AXTitle` / `AXDescription` / `AXHelp` of **buttons** and progress indicators | text areas, static text, web content |
| the running app's bundle id and pid | window titles, file paths, project names |

Button labels longer than 120 characters are discarded unread — a label that
long is not a button label. Chat text therefore has no path into this process.

## How a turn is detected

Three defences against false positives, which are the whole risk of driving an
overlay off a UI rather than an API:

1. **Several signals, scored.** A Stop/Cancel control is worth 2, a progress
   indicator 1, and "Stop present *and* Send gone" another 1. A turn opens at a
   score of 3 — one lone button is never enough.
2. **Hysteresis.** The state only flips after 2 consecutive polls agree, so a
   redraw or a momentarily-detached tree cannot start a turn.
3. **A watchdog.** A turn the UI never closes is closed at 600 s, and an IDE
   that quits mid-turn closes its turn on the next poll.

A "turn" shorter than 250 ms is discarded as UI noise.

## Build and run

```bash
npm run ax:build                                  # swift build -c release
./adapters/ax/.build/release/focusreels-ax --profile jetbrains --verbose
```

Options: `--profile jetbrains|vscode`, `--interval 0.4` (seconds, 0.15–2.0),
`--socket <path>`, `--verbose`.

## Accessibility permission

The binary prompts on first run. Permission is granted to **the app that runs
it** — your terminal, not the binary — under
**System Settings → Privacy & Security → Accessibility**. Without it the adapter
exits with an explanation rather than silently seeing nothing.

## Tuning it for your IDE

The label patterns live in `Sources/focusreels-ax/Profile.swift`
(`stopPatterns` / `sendPatterns`). JetBrains changes its chat UI between
releases, and a localized IDE uses localized labels — if the overlay never
appears, run with `--verbose` and add the label your build actually uses.

This is the least precise of the three adapters by construction. Prefer hooks
wherever they exist.
