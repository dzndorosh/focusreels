# VS Code + Copilot Agent adapter

Agent Hooks are in **Preview**. Two things follow from that, and the adapter is
built around both:

1. **The hook payload schema is not frozen.** `focusreels-copilot-hook.sh` never
   assumes one field name — it passes a list of candidates
   (`sessionId,turnId,requestId,conversationId,…`) to `--id-from-stdin` and takes
   the first that is present. If none is, the emitter falls back to a single
   `default` lane per IDE, which still opens and closes the overlay correctly
   for one chat at a time.
2. **The feature can be off.** Preview features can be disabled by the user or
   blocked by organisation policy, in which case the hooks never fire and
   FocusReels would simply never show up for VS Code. That is the failure the
   fallback below exists for.

## Install (hooks path)

Copy `hooks.json` into either:

- the workspace: `.vscode/hooks.json`, or
- your user profile hooks file, if your VS Code build exposes one.

Point the `command` at wherever you cloned FocusReels, then reload the window.
Verify: run `npm start`, send a long prompt in Copilot chat, and the overlay
should appear after ~500 ms.

## Fallback when hooks are unavailable

Run the Accessibility adapter against VS Code instead:

```bash
npm run ax:build
./adapters/ax/.build/release/focusreels-ax --profile vscode
```

It watches the chat's Stop/Send controls rather than the hook stream, reports
itself as `vscode-copilot`, and needs the same Accessibility permission as the
JetBrains profile. It is less precise than hooks — use it only when hooks are
not an option.

## Checking which path is live

```bash
node dist/cli/emit.js --source vscode-copilot --event turn_started --turn-id probe
# overlay appears after ~500 ms
node dist/cli/emit.js --source vscode-copilot --event turn_ended --turn-id probe --outcome completed
```

If the manual probe works but a real prompt does not, the hooks are not firing —
switch to the fallback.
