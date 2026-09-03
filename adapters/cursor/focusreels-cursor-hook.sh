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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec /bin/sh "$SCRIPT_DIR/../shared/focusreels-hook.sh" \
  cursor "${1:-}" generation_id,generationId,conversation_id,conversationId status >/dev/null 2>&1
