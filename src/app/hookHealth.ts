/**
 * The doctor's first check, run by the app itself at startup.
 *
 * `npm run doctor` is only useful to someone who suspects a problem. The
 * failure this guards against gives no reason to suspect anything: the menu bar
 * looks healthy, and the error appears in a *different* program's window. So
 * the app reads the same config files the agents read, and says so in the only
 * place it can — its own menu.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { auditRefs, claudeHookRefs, flatHookRefs, type Problem } from '../doctor/audit.js';

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Absent or hand-broken: neither is this check's business to report. A
    // config we cannot read holds no hooks we could call broken.
    return null;
  }
}

export function findBrokenHooks(home = homedir()): Problem[] {
  const claude = readJson(process.env.FOCUSREELS_CLAUDE_SETTINGS ?? join(home, '.claude', 'settings.json'));
  const cursor = readJson(process.env.FOCUSREELS_CURSOR_HOOKS ?? join(home, '.cursor', 'hooks.json'));

  return auditRefs(
    [...claudeHookRefs(claude, home), ...flatHookRefs(cursor, 'cursor', home)],
    existsSync,
  );
}

/** The one line the menu bar shows, or nothing at all when all is well. */
export function brokenHooksLine(problems: Problem[]): string | null {
  if (problems.length === 0) return null;
  const targets = [...new Set(problems.map((p) => p.ref.target))].join(', ');
  return `⚠ ${problems.length} broken hook(s) in ${targets} — run \`npm run doctor\``;
}
