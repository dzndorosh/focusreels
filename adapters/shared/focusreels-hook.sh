#!/bin/sh
# Minimal macOS hook runtime for FocusReels.
#
# Usage: focusreels-hook.sh <source> <started|ended|error> <id-fields> [status-field]
#
# It deliberately needs no checkout, Node.js, or bundled JavaScript. macOS
# supplies both plutil (JSON field extraction) and nc (Unix-socket delivery).
# A hook must never disturb the AI tool that called it, so every failure is
# silent and exits successfully.

set -u

SOURCE="${1:-}"
KIND="${2:-}"
ID_FIELDS="${3:-}"
STATUS_FIELD="${4:-}"
SOCKET="${FOCUSREELS_SOCKET:-$HOME/Library/Application Support/FocusReels/broker.sock}"

case "$SOURCE:$KIND" in
  cursor:started|cursor:ended|vscode-copilot:started|vscode-copilot:ended|claude-code:started|claude-code:ended|claude-code:error)
    ;;
  *) exit 0 ;;
esac

# Hook hosts send one JSON object and close stdin. Keep it local: no prompt,
# response, cwd, or other payload field is ever forwarded.
PAYLOAD="$(cat 2>/dev/null)"

opaque_id() {
  printf '%s' "$1" | tr -cd 'A-Za-z0-9._:-' | cut -c1-128
}

TURN_ID=''
OLD_IFS="$IFS"
IFS=','
for FIELD in $ID_FIELDS; do
  VALUE="$(printf '%s' "$PAYLOAD" | /usr/bin/plutil -extract "$FIELD" raw - 2>/dev/null)" || continue
  TURN_ID="$(opaque_id "$VALUE")"
  [ -n "$TURN_ID" ] && break
done
IFS="$OLD_IFS"
[ -n "$TURN_ID" ] || TURN_ID='default'

EVENT='turn_started'
OUTCOME=''
case "$KIND" in
  started) ;;
  ended)
    EVENT='turn_ended'
    OUTCOME='completed'
    if [ -n "$STATUS_FIELD" ]; then
      STATUS="$(printf '%s' "$PAYLOAD" | /usr/bin/plutil -extract "$STATUS_FIELD" raw - 2>/dev/null | tr '[:upper:]' '[:lower:]')" || STATUS=''
      case "$STATUS" in
        aborted|abort|cancelled|canceled|interrupted|stopped) OUTCOME='aborted' ;;
        error|failed|failure) OUTCOME='error' ;;
      esac
    fi
    ;;
  error)
    EVENT='turn_ended'
    OUTCOME='error'
    ;;
esac

if [ -n "$OUTCOME" ]; then
  LINE="{\"source\":\"$SOURCE\",\"turn_id\":\"$TURN_ID\",\"event\":\"$EVENT\",\"outcome\":\"$OUTCOME\"}"
else
  LINE="{\"source\":\"$SOURCE\",\"turn_id\":\"$TURN_ID\",\"event\":\"$EVENT\"}"
fi

printf '%s\n' "$LINE" | /usr/bin/nc -U -w 1 "$SOCKET" >/dev/null 2>&1 || :
exit 0
