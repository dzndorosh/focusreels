#!/bin/sh
# Merge the FocusReels hooks into ~/.cursor/hooks.json, keeping whatever is
# already configured there. Re-running is safe.
set -eu

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HOOKS_FILE="$HOME/.cursor/hooks.json"
SCRIPT="$REPO_DIR/adapters/cursor/focusreels-cursor-hook.sh"

mkdir -p "$HOME/.cursor"
[ -f "$HOOKS_FILE" ] || echo '{"version":1,"hooks":{}}' > "$HOOKS_FILE"
cp "$HOOKS_FILE" "$HOOKS_FILE.focusreels.bak"

node -e '
const fs = require("fs");
const [file, script] = process.argv.slice(1);
const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
cfg.version = cfg.version || 1;
cfg.hooks = cfg.hooks || {};
const add = (event, arg) => {
  const list = (cfg.hooks[event] = cfg.hooks[event] || []);
  const command = `${script} ${arg}`;
  if (!list.some((h) => typeof h.command === "string" && h.command.includes("focusreels"))) {
    list.push({ command });
  }
};
add("beforeSubmitPrompt", "started");
add("stop", "ended");
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
' "$HOOKS_FILE" "$SCRIPT"

echo "Installed FocusReels hooks into $HOOKS_FILE"
echo "Backup: $HOOKS_FILE.focusreels.bak"
echo "Restart Cursor for the hooks to load."
