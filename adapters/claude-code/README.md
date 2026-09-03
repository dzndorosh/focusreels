# Claude Code adapter — also covers Orca and other GUI shells

Claude Code has its own hook system, and it belongs to the **CLI**, not to any
particular window. So one adapter covers every way you run it: the terminal,
Orca, or any other GUI shell built on top of the CLI.

## Install

```bash
npm run install:claude     # merges into ~/.claude/settings.json
```

Then **start a new agent session** — hooks are read at session start.

Remove it again with `npm run uninstall:claude`.

## What it hooks, and why those three

| Claude Code event | FocusReels event |
|---|---|
| `UserPromptSubmit` | `turn_started` |
| `Stop` | `turn_ended` · `completed` |
| `StopFailure` | `turn_ended` · `error` |

`session_id` from the payload becomes the `turn_id`. Nothing else is read — not
`prompt`, not `cwd`, not `transcript_path`.

`SubagentStart` / `SubagentStop` are deliberately **not** hooked: a subagent runs
inside a turn that `UserPromptSubmit` already opened, so hooking them would open
a second turn for work that is already covered.

## Living next to other hooks

Claude Code allows several hooks per event, so ours is appended as its own group
and everything already registered — an Orca install, a corporate hook, your own —
is left untouched. The installer is idempotent (running it three times still
leaves one hook) and `--uninstall` restores the file exactly as it was.

A backup is written to `~/.claude/settings.json.focusreels.bak` on every run, and
a settings file that does not parse is refused rather than overwritten.

## Two rules the hook script obeys

Both are about never disturbing the agent:

1. **Exit 0 on every path.** A failing hook can block a prompt. Missing Node,
   missing build, app not running — all exit 0, silently.
2. **Print nothing to stdout.** On `UserPromptSubmit`, a hook's stdout is
   injected into the model's context. A stray line would literally appear inside
   your conversation, so every call is redirected to `/dev/null`.

## Verify it works

In a second terminal:

```bash
npm run headless
```

Send a prompt to your agent. You should see:

```
claude-code#<session id> -> waiting
claude-code#<session id> -> active
>>> SHOW overlay
```

Nothing at all means the hooks are not loaded — start a **new** session, since an
already-running one keeps the hook config it started with.

## Known limit

The "IDE went away" safety net does not apply here. Claude Code runs inside
whatever terminal or GUI shell you use, so there is no single process whose
absence means the agent is gone. A turn that never sends `Stop` is closed by the
watchdog instead (10 minutes by default).
