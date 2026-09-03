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
    run_merger claude-code install "$SETTINGS" focusreels-claude-hook.sh \
      UserPromptSubmit "$COMMAND started" Stop "$COMMAND ended" StopFailure "$COMMAND error"
    echo "Installed FocusReels Claude Code hooks into $SETTINGS"
    ;;
  claude-code:uninstall)
    SETTINGS="${FOCUSREELS_CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
    run_merger claude-code uninstall "$SETTINGS" focusreels-claude-hook.sh \
      UserPromptSubmit unused Stop unused StopFailure unused
    echo "Removed FocusReels Claude Code hooks from $SETTINGS"
    ;;
  cursor:install)
    install_assets
    SETTINGS="${FOCUSREELS_CURSOR_HOOKS:-$HOME/.cursor/hooks.json}"
    HOOK="$ADAPTER_HOME/cursor/focusreels-cursor-hook.sh"
    COMMAND="/bin/sh $(quote_for_shell "$HOOK")"
    run_merger cursor install "$SETTINGS" focusreels-cursor-hook.sh \
      beforeSubmitPrompt "$COMMAND started" stop "$COMMAND ended"
    echo "Installed FocusReels Cursor hooks into $SETTINGS"
    ;;
  cursor:uninstall)
    SETTINGS="${FOCUSREELS_CURSOR_HOOKS:-$HOME/.cursor/hooks.json}"
    run_merger cursor uninstall "$SETTINGS" focusreels-cursor-hook.sh \
      beforeSubmitPrompt unused stop unused
    echo "Removed FocusReels Cursor hooks from $SETTINGS"
    ;;
  vscode-copilot:install)
    install_assets
    HOOK="$ADAPTER_HOME/vscode-copilot/focusreels-copilot-hook.sh"
    CONFIG="$ADAPTER_HOME/vscode-copilot/hooks.json"
    /usr/bin/plutil -replace hooks.UserPromptSubmit.0.command -string "/bin/sh $(quote_for_shell "$HOOK") started" "$CONFIG"
    /usr/bin/plutil -replace hooks.Stop.0.command -string "/bin/sh $(quote_for_shell "$HOOK") ended" "$CONFIG"
    echo "Wrote $CONFIG — copy it to .vscode/hooks.json or your VS Code hooks profile."
    ;;
  *)
    echo "Usage: $0 <claude-code|cursor|vscode-copilot> [install|uninstall]" >&2
    exit 64
    ;;
esac
