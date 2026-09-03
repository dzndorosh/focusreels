#!/usr/bin/env node
/**
 * Merge the FocusReels hooks into ~/.claude/settings.json.
 *
 * Claude Code allows several hooks per event, so ours sits alongside whatever
 * is already registered — an Orca install, a corporate hook, your own. Existing
 * entries are never touched and re-running is safe (idempotent by a marker).
 *
 *   node adapters/claude-code/install.mjs            # install
 *   node adapters/claude-code/install.mjs --uninstall
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = 'focusreels-claude-hook.sh';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(repo, 'adapters', 'claude-code', 'focusreels-claude-hook.sh');
const settingsFile = join(homedir(), '.claude', 'settings.json');

/** Event → the argument our script gets. StopFailure is how a turn errors out. */
const WIRING = {
  UserPromptSubmit: 'started',
  Stop: 'ended',
  StopFailure: 'error',
};

const uninstall = process.argv.includes('--uninstall');

function read() {
  if (!existsSync(settingsFile)) return {};
  try {
    return JSON.parse(readFileSync(settingsFile, 'utf8'));
  } catch (err) {
    console.error(`Could not parse ${settingsFile}: ${err.message}`);
    console.error('Fix the file first — refusing to overwrite it.');
    process.exit(1);
  }
}

const settings = read();
settings.hooks ??= {};

if (existsSync(settingsFile)) {
  const backup = `${settingsFile}.focusreels.bak`;
  copyFileSync(settingsFile, backup);
  console.log(`Backup: ${backup}`);
}

let changed = 0;

for (const [event, arg] of Object.entries(WIRING)) {
  const groups = (settings.hooks[event] ??= []);

  // Drop ours wherever it is, then re-add if installing. Keeps everyone else's.
  for (const group of groups) {
    if (!Array.isArray(group.hooks)) continue;
    const before = group.hooks.length;
    group.hooks = group.hooks.filter(
      (h) => !(typeof h.command === 'string' && h.command.includes(MARKER)),
    );
    changed += before - group.hooks.length;
  }
  // Remove groups we emptied, but never a group that was empty already.
  settings.hooks[event] = groups.filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);

  if (!uninstall) {
    settings.hooks[event].push({
      hooks: [{ type: 'command', command: `/bin/sh ${JSON.stringify(script)} ${arg}`, timeout: 5 }],
    });
    changed += 1;
  }
}

mkdirSync(dirname(settingsFile), { recursive: true });
writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n', 'utf8');

console.log(
  uninstall
    ? `Removed ${changed} FocusReels hook(s) from ${settingsFile}`
    : `Installed FocusReels hooks into ${settingsFile} (${Object.keys(WIRING).join(', ')})`,
);
console.log('Start a NEW agent session for the change to take effect.');
