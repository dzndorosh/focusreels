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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec /bin/sh "$SCRIPT_DIR/../shared/focusreels-hook.sh" \
  vscode-copilot "${1:-}" sessionId,session_id,turnId,turn_id,requestId,request_id,conversationId,conversation_id status >/dev/null 2>&1
