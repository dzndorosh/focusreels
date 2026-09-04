#!/bin/sh
# Installs FocusReels hooks from either a source checkout or an app bundle.
# The installed hooks run on macOS system tools only; Node is never required.

set -eu

TARGET="${1:-}"
OPERATION="${2:-install}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADAPTER_HOME="${FOCUSREELS_ADAPTER_HOME:-$HOME/Library/Application Support/FocusReels/adapters}"
MERGER="$ADAPTER_HOME/shared/merge-hooks.js"

quote_for_shell() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

install_assets() {
  mkdir -p "$ADAPTER_HOME"
  /usr/bin/ditto "$SCRIPT_DIR/shared" "$ADAPTER_HOME/shared"
  /usr/bin/ditto "$SCRIPT_DIR/generic" "$ADAPTER_HOME/generic"
  /usr/bin/ditto "$SCRIPT_DIR/cursor" "$ADAPTER_HOME/cursor"
  /usr/bin/ditto "$SCRIPT_DIR/claude-code" "$ADAPTER_HOME/claude-code"
  /usr/bin/ditto "$SCRIPT_DIR/vscode-copilot" "$ADAPTER_HOME/vscode-copilot"
}

run_merger() {
  /usr/bin/osascript -l JavaScript "$MERGER" "$@"
}

case "$TARGET:$OPERATION" in
  claude-code:install)
    install_assets
    SETTINGS="${FOCUSREELS_CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
    HOOK="$ADAPTER_HOME/claude-code/focusreels-claude-hook.sh"
    COMMAND="/bin/sh $(quote_for_shell "$HOOK")"
    # Five hooks, because two are not enough to know whether the agent is
    # thinking right now:
    #   Notification  the agent parked on a permission prompt or a question —
    #                 it is waiting for the human, so the overlay must go.
    #   PreToolUse    a tool is about to run — the heartbeat that keeps a long
    #                 command (a test suite, a build) from looking like silence.
    #   PostToolUse   a tool ran: proof of life, and the signal that the human
    #                 answered that prompt and work has resumed.
    #   SessionEnd    the session went away without ever sending Stop.
    #
    # Every name here was checked against the hook table and the executeXHooks
    # symbols in the installed Claude Code binary, not against documentation:
    # StopFailure and SessionEnd are real but absent from the short table, and
    # SubagentStop has no executor at all, so it is deliberately not used.
    run_merger claude-code install "$SETTINGS" focusreels-claude-hook.sh \
      UserPromptSubmit "$COMMAND started" \
      PreToolUse "$COMMAND progress" \
      PostToolUse "$COMMAND progress" \
      PostToolUseFailure "$COMMAND progress" \
      SubagentStart "$COMMAND progress" \
      Notification "$COMMAND paused" \
      Stop "$COMMAND ended" \
      StopFailure "$COMMAND error" \
      SessionEnd "$COMMAND ended"
    echo "Installed FocusReels Claude Code hooks into $SETTINGS"
    ;;
  claude-code:uninstall)
    SETTINGS="${FOCUSREELS_CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
    run_merger claude-code uninstall "$SETTINGS" focusreels-claude-hook.sh \
      UserPromptSubmit unused PreToolUse unused PostToolUse unused \
      PostToolUseFailure unused SubagentStart unused Notification unused \
      Stop unused StopFailure unused SessionEnd unused
    echo "Removed FocusReels Claude Code hooks from $SETTINGS"
    ;;
  cursor:install)
    install_assets
    SETTINGS="${FOCUSREELS_CURSOR_HOOKS:-$HOME/.cursor/hooks.json}"
    HOOK="$ADAPTER_HOME/cursor/focusreels-cursor-hook.sh"
    COMMAND="/bin/sh $(quote_for_shell "$HOOK")"
    # afterFileEdit is purely observational, so it is safe to hook: Cursor's
    # gating hooks (beforeShellExecution, beforeMCPExecution) read the hook's
    # stdout as a permission decision, and this runtime prints nothing by
    # design — hooking those could interfere with the agent's own execution.
    run_merger cursor install "$SETTINGS" focusreels-cursor-hook.sh \
      beforeSubmitPrompt "$COMMAND started" \
      afterFileEdit "$COMMAND progress" \
      stop "$COMMAND ended"
    echo "Installed FocusReels Cursor hooks into $SETTINGS"
    ;;
  cursor:uninstall)
    SETTINGS="${FOCUSREELS_CURSOR_HOOKS:-$HOME/.cursor/hooks.json}"
    run_merger cursor uninstall "$SETTINGS" focusreels-cursor-hook.sh \
      beforeSubmitPrompt unused afterFileEdit unused stop unused
    echo "Removed FocusReels Cursor hooks from $SETTINGS"
    ;;
  vscode-copilot:install)
    install_assets
    HOOK="$ADAPTER_HOME/vscode-copilot/focusreels-copilot-hook.sh"
    CONFIG="$ADAPTER_HOME/vscode-copilot/hooks.json"
    /usr/bin/plutil -replace hooks.UserPromptSubmit.0.command -string "/bin/sh $(quote_for_shell "$HOOK") started" "$CONFIG"
    /usr/bin/plutil -replace hooks.PreToolUse.0.command -string "/bin/sh $(quote_for_shell "$HOOK") progress" "$CONFIG"
    /usr/bin/plutil -replace hooks.PostToolUse.0.command -string "/bin/sh $(quote_for_shell "$HOOK") progress" "$CONFIG"
    /usr/bin/plutil -replace hooks.SubagentStart.0.command -string "/bin/sh $(quote_for_shell "$HOOK") progress" "$CONFIG"
    /usr/bin/plutil -replace hooks.Stop.0.command -string "/bin/sh $(quote_for_shell "$HOOK") ended" "$CONFIG"
    /usr/bin/plutil -replace hooks.SessionEnd.0.command -string "/bin/sh $(quote_for_shell "$HOOK") ended" "$CONFIG"
    /usr/bin/plutil -replace hooks.ErrorOccurred.0.command -string "/bin/sh $(quote_for_shell "$HOOK") error" "$CONFIG"
    echo "Wrote $CONFIG — copy it to .vscode/hooks.json or your VS Code hooks profile."
    ;;
  *)
    echo "Usage: $0 <claude-code|cursor|vscode-copilot> [install|uninstall]" >&2
    exit 64
    ;;
esac
