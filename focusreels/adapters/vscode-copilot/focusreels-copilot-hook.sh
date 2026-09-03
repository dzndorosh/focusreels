#!/bin/sh
# VS Code + Copilot Agent hook -> FocusReels.
#
# Invoked as:  focusreels-copilot-hook.sh started|ended
# Agent Hooks pass their payload as JSON on stdin. We take an opaque session /
# turn id and, on Stop, a status. Nothing else is read or forwarded.
#
# Agent Hooks are a Preview feature and can be switched off by organisation
# policy. When that happens this script is simply never called — see
# ../ax/README.md for the Accessibility fallback.

set -u

EVENT_KIND="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${FOCUSREELS_HOME:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
EMIT="$APP_DIR/dist/cli/emit.js"
NODE_BIN="${FOCUSREELS_NODE:-$(command -v node || echo /usr/local/bin/node)}"

[ -x "$NODE_BIN" ] || exit 0
[ -f "$EMIT" ] || exit 0

IDS="sessionId,session_id,turnId,turn_id,requestId,request_id,conversationId,conversation_id"

case "$EVENT_KIND" in
  started)
    "$NODE_BIN" "$EMIT" --source vscode-copilot --event turn_started --id-from-stdin "$IDS"
    ;;
  ended)
    "$NODE_BIN" "$EMIT" --source vscode-copilot --event turn_ended \
      --id-from-stdin "$IDS" --outcome-from-stdin status
    ;;
esac

exit 0
