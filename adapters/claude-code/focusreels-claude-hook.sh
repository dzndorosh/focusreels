#!/bin/sh
# Claude Code hook -> FocusReels.
#
# Covers every environment that runs Claude Code, including GUI shells built on
# top of it such as Orca — the hooks belong to the CLI, not to the window.
#
# Invoked as:  focusreels-claude-hook.sh started|ended|error
# Claude Code puts the hook payload on stdin as JSON; we read `session_id` out
# of it and nothing else.
#
# Two hard rules, both about not disturbing the agent:
#   * exit 0 on every path — a hook that fails can block a prompt;
#   * print NOTHING to stdout — on UserPromptSubmit, stdout is injected into the
#     model's context, so a stray line would end up inside your conversation.

set -u

EVENT_KIND="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${FOCUSREELS_HOME:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
EMIT="$APP_DIR/dist/cli/emit.js"
NODE_BIN="${FOCUSREELS_NODE:-$(command -v node || echo /usr/local/bin/node)}"

[ -x "$NODE_BIN" ] || exit 0
[ -f "$EMIT" ] || exit 0

IDS="session_id,sessionId"

case "$EVENT_KIND" in
  started)
    "$NODE_BIN" "$EMIT" --source claude-code --event turn_started \
      --id-from-stdin "$IDS" >/dev/null 2>&1
    ;;
  ended)
    "$NODE_BIN" "$EMIT" --source claude-code --event turn_ended \
      --id-from-stdin "$IDS" --outcome completed >/dev/null 2>&1
    ;;
  error)
    "$NODE_BIN" "$EMIT" --source claude-code --event turn_ended \
      --id-from-stdin "$IDS" --outcome error >/dev/null 2>&1
    ;;
esac

exit 0
