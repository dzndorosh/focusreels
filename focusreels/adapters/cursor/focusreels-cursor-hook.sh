#!/bin/sh
# Cursor hook -> FocusReels.
#
# Invoked as:  focusreels-cursor-hook.sh started|ended
# Cursor passes the hook payload as JSON on stdin. We read exactly two fields
# out of it — an opaque turn id and a status — and forward nothing else.
#
# This script must never fail: a broken overlay is not a reason to break a
# prompt, so every path exits 0.

set -u

EVENT_KIND="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${FOCUSREELS_HOME:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
EMIT="$APP_DIR/dist/cli/emit.js"
NODE_BIN="${FOCUSREELS_NODE:-$(command -v node || echo /usr/local/bin/node)}"

[ -x "$NODE_BIN" ] || exit 0
[ -f "$EMIT" ] || exit 0

case "$EVENT_KIND" in
  started)
    "$NODE_BIN" "$EMIT" \
      --source cursor \
      --event turn_started \
      --id-from-stdin generation_id,generationId,conversation_id,conversationId
    ;;
  ended)
    "$NODE_BIN" "$EMIT" \
      --source cursor \
      --event turn_ended \
      --id-from-stdin generation_id,generationId,conversation_id,conversationId \
      --outcome-from-stdin status
    ;;
esac

exit 0
