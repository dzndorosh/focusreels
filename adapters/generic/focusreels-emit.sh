#!/bin/sh
# Wire any AI tool to FocusReels in one line, without writing an adapter.
#
#   focusreels-emit.sh <source> <started|progress|paused|ended|error> [turn-id]
#
# The protocol is open — the app validates a source id by shape, not against a
# list — so this exists for every tool the project does not ship a hook for:
# Codex, Gemini CLI, aider, a Makefile, a wrapper script of your own. Point your
# tool's notify/hook/callback mechanism at it and the overlay works exactly as
# it does for the bundled adapters.
#
#   <source>   a-z, 0-9 and dashes, e.g. `codex`. It appears in the menu bar and
#              gets its own on/off switch the first time it is seen.
#   [turn-id]  anything opaque that is stable for one request — a session or
#              conversation id. Omit it and the tool gets a single lane, which
#              is right for a CLI that runs one request at a time.
#
# Reads nothing from stdin and prints nothing: it is safe to call from a hook
# whose stdout is interpreted by the agent.
set -u

SOURCE="${1:-}"
KIND="${2:-}"
TURN_ID="${3:-default}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FOCUSREELS_TURN_ID="$TURN_ID" \
  exec /bin/sh "$SCRIPT_DIR/../shared/focusreels-hook.sh" "$SOURCE" "$KIND" '' \
  </dev/null >/dev/null 2>&1
