#!/usr/bin/env node
/**
 * focusreels doctor — proves the plumbing, instead of asserting it.
 *
 * The installer can only report what it wrote. This runs the commands that are
 * actually in the config files, against a socket of its own, and reports what
 * came out the other end. That is the difference between "we wrote a hook" and
 * "a hook works".
 *
 * It executes commands read from the user's own tool configs. That is the point
 * — it is checking exactly what the agent would run — but it is worth knowing
 * that it is what this program does.
 */

import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { socketPath, supportDir } from '../broker/paths.js';
import {
  auditRefs,
  claudeHookRefs,
  describeProblem,
  flatHookRefs,
  type HookRef,
} from '../doctor/audit.js';

const HOME = homedir();

interface Target {
  name: string;
  configPath: string;
  refsOf: (parsed: unknown) => HookRef[];
  installHint: string;
}

const TARGETS: Target[] = [
  {
    name: 'claude-code',
    configPath: process.env.FOCUSREELS_CLAUDE_SETTINGS ?? join(HOME, '.claude', 'settings.json'),
    refsOf: (parsed) => claudeHookRefs(parsed, HOME),
    installHint: 'npm run install:claude',
  },
  {
    name: 'cursor',
    configPath: process.env.FOCUSREELS_CURSOR_HOOKS ?? join(HOME, '.cursor', 'hooks.json'),
    refsOf: (parsed) => flatHookRefs(parsed, 'cursor', HOME),
    installHint: 'npm run install:cursor',
  },
  {
    name: 'vscode-copilot',
    configPath: join(supportDir(), 'adapters', 'vscode-copilot', 'hooks.json'),
    refsOf: (parsed) => flatHookRefs(parsed, 'vscode-copilot', HOME),
    installHint: 'npm run install:vscode-copilot',
  },
];

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Runs one hook command for real and returns the event it produced, if any.
 * The command keeps its own arguments — this is the config's command, not a
 * reconstruction of it.
 */
async function roundTrip(command: string, directory: string): Promise<string | null> {
  const sock = join(directory, 'd.sock');
  let line: string | null = null;

  const server = createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
    });
    socket.on('end', () => {
      if (!line && buffer.trim()) line = buffer.trim();
    });
  });
  await new Promise<void>((resolve) => server.listen(sock, resolve));

  const child = spawn('/bin/sh', ['-c', command], {
    env: { ...process.env, FOCUSREELS_SOCKET: sock, FOCUSREELS_SUPPORT_DIR: directory },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  // A hook that exits before reading its stdin — which is exactly what a fast
  // path or a broken command does — closes the pipe under us. That is a normal
  // outcome to observe, not a crash to propagate.
  child.stdin.on('error', () => {});
  child.stdin.end('{"session_id":"focusreels-doctor","generation_id":"focusreels-doctor"}');
  await new Promise((resolve) => child.once('close', resolve));

  // The hook's `nc` closes on its own; give the listener a moment to see it.
  for (let i = 0; i < 100 && line === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return line;
}

async function main(): Promise<void> {
  const out: string[] = [];
  let failures = 0;

  const running = existsSync(socketPath());
  out.push(running ? '✓ FocusReels is running' : '· FocusReels is not running (start it to see turns)');

  const directory = mkdtempSync(join(tmpdir(), 'fr-'));
  try {
    for (const target of TARGETS) {
      const parsed = readJson(target.configPath);
      if (parsed === null) {
        out.push(`· ${target.name}: no config at ${target.configPath} — run \`${target.installHint}\``);
        continue;
      }

      const refs = target.refsOf(parsed);
      if (refs.length === 0) {
        out.push(`· ${target.name}: no FocusReels hooks installed — run \`${target.installHint}\``);
        continue;
      }

      const problems = auditRefs(refs, existsSync);
      for (const problem of problems) {
        failures += 1;
        out.push(`✗ ${describeProblem(problem)}`);
      }
      if (problems.length > 0) {
        out.push(`  → fix with \`${target.installHint}\`, then start a new session`);
        continue;
      }

      // Every script exists; now find out whether running one produces an event.
      const probe = refs[0];
      if (!probe) continue;
      const line = await roundTrip(probe.command, directory);
      if (line === null) {
        failures += 1;
        out.push(`✗ ${target.name}: ${refs.length} hook(s) installed, but running ${probe.event} produced no event`);
        out.push(`  → fix with \`${target.installHint}\`, then start a new session`);
      } else {
        out.push(`✓ ${target.name}: ${refs.length} hook(s), and ${probe.event} really emits — ${line}`);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  // writeSync, not console.log: stdout to a pipe is asynchronous, and a report
  // that loses its last lines on exit is worse than no report.
  writeSync(1, out.join('\n') + '\n');
  if (failures > 0) {
    writeSync(1, `\n${failures} problem(s). Hooks are read when a session starts, so restart the tool after fixing.\n`);
    process.exitCode = 1;
  }
}

void main();
