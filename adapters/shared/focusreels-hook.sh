#!/bin/sh
# Minimal macOS hook runtime for FocusReels.
#
# Usage: focusreels-hook.sh <source> <kind> <id-fields> [status-field]
#   kind: started | progress | paused | ended | error
#
# It deliberately needs no checkout, Node.js, or bundled JavaScript. macOS
# supplies both plutil (JSON field extraction) and nc (Unix-socket delivery).
# A hook must never disturb the AI tool that called it, so every failure is
# silent and exits successfully.
#
# The four kinds beyond start/end all exist to answer one question the overlay
# cannot answer for itself: *is the agent still thinking right now?*
#
#   progress  a sign of life. Pushes the silence timer back, so that timer can
#             be short enough to catch a lost `ended` without cutting a
#             legitimately long turn short.
#   paused    the agent stopped and is waiting for the human (a permission
#             prompt, a question). It is not thinking, so the overlay must go —
#             this is the single most common way the old build kept playing
#             video over the exact moment the user had to read something.
#   error     the turn died.
#
# `paused` drops a marker; the next `progress` sees it and re-opens the turn,
# which is what makes the pause a pause rather than an end.

set -u

SOURCE="${1:-}"
KIND="${2:-}"
ID_FIELDS="${3:-}"
STATUS_FIELD="${4:-}"
SUPPORT="${FOCUSREELS_SUPPORT_DIR:-$HOME/Library/Application Support/FocusReels}"
SOCKET="${FOCUSREELS_SOCKET:-$SUPPORT/broker.sock}"
STATE_DIR="${FOCUSREELS_STATE_DIR:-$SUPPORT/state}"

# Nothing to talk to, nothing to do. This is the first check rather than the
# last because heartbeats now fire on every tool call: a user who has the hooks
# installed but the app closed would otherwise pay for a JSON parse and a socket
# attempt on every single one. Exiting here costs a shell spawn and nothing else.
[ -S "$SOCKET" ] || exit 0

# Any tool may ship an adapter, so the source is validated by shape (the same
# rule the app enforces in SOURCE_ID_RE) rather than by a list this file would
# have to be edited to extend.
case "$SOURCE" in
  '' | *[!a-z0-9-]* | -*) exit 0 ;;
esac
# 32 chars, matching SOURCE_ID_RE: a longer id would be dropped by the app, and
# dropping it here keeps the failure in one place instead of two.
[ "${#SOURCE}" -le 32 ] || exit 0
case "$KIND" in
  started | progress | paused | ended | error) ;;
  *) exit 0 ;;
esac

# Hook hosts send one JSON object and close stdin. Keep it local: no prompt,
# response, cwd, or other payload field is ever forwarded. A caller that already
# knows its turn id (see adapters/generic) passes it in the environment instead,
# and then nothing is read at all.
if [ -n "${FOCUSREELS_TURN_ID:-}" ]; then
  PAYLOAD=''
else
  PAYLOAD="$(cat 2>/dev/null)"
fi

opaque_id() {
  printf '%s' "$1" | tr -cd 'A-Za-z0-9._:-' | cut -c1-128
}

TURN_ID="$(printf '%s' "${FOCUSREELS_TURN_ID:-}" | tr -cd 'A-Za-z0-9._:-' | cut -c1-128)"
OLD_IFS="$IFS"
IFS=','
[ -n "$TURN_ID" ] && ID_FIELDS=''
for FIELD in $ID_FIELDS; do
  VALUE="$(printf '%s' "$PAYLOAD" | /usr/bin/plutil -extract "$FIELD" raw - 2>/dev/null)" || continue
  TURN_ID="$(opaque_id "$VALUE")"
  [ -n "$TURN_ID" ] && break
done
IFS="$OLD_IFS"
[ -n "$TURN_ID" ] || TURN_ID='default'

MARKER="$STATE_DIR/paused-$SOURCE-$TURN_ID"

send() {
  # $1 = event name, $2 = outcome (may be empty)
  if [ -n "$2" ]; then
    LINE="{\"source\":\"$SOURCE\",\"turn_id\":\"$TURN_ID\",\"event\":\"$1\",\"outcome\":\"$2\"}"
  else
    LINE="{\"source\":\"$SOURCE\",\"turn_id\":\"$TURN_ID\",\"event\":\"$1\"}"
  fi
  printf '%s\n' "$LINE" | /usr/bin/nc -U -w 1 "$SOCKET" >/dev/null 2>&1 || :
}

case "$KIND" in
  started)
    rm -f "$MARKER" 2>/dev/null || :
    send turn_started ''
    ;;

  progress)
    # A tool ran. If the turn was parked on a permission prompt, the human has
    # answered by now and the agent is thinking again — re-open before the
    # heartbeat, so the heartbeat lands on a turn that exists.
    if [ -f "$MARKER" ]; then
      rm -f "$MARKER" 2>/dev/null || :
      send turn_started ''
    fi
    send turn_progress ''
    ;;

  paused)
    mkdir -p "$STATE_DIR" 2>/dev/null || :
    : > "$MARKER" 2>/dev/null || :
    send turn_ended completed
    ;;

  ended)
    rm -f "$MARKER" 2>/dev/null || :
    OUTCOME='completed'
    if [ -n "$STATUS_FIELD" ]; then
      STATUS="$(printf '%s' "$PAYLOAD" | /usr/bin/plutil -extract "$STATUS_FIELD" raw - 2>/dev/null | tr '[:upper:]' '[:lower:]')" || STATUS=''
      case "$STATUS" in
        aborted | abort | cancelled | canceled | interrupted | stopped) OUTCOME='aborted' ;;
        error | failed | failure) OUTCOME='error' ;;
      esac
    fi
    send turn_ended "$OUTCOME"
    ;;

  error)
    rm -f "$MARKER" 2>/dev/null || :
    send turn_ended error
    ;;
esac

exit 0
