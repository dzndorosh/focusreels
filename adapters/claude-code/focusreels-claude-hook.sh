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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec /bin/sh "$SCRIPT_DIR/../shared/focusreels-hook.sh" \
  claude-code "${1:-}" session_id,sessionId >/dev/null 2>&1
