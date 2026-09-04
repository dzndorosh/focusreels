import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'dist', 'cli', 'doctor.js');
if (!existsSync(script)) {
  throw new Error(`${script} is missing — run \`npm run build\` before the tests`);
}
const directories: string[] = [];
afterEach(() => {
  for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
});

const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'fr-doctor-'));
  directories.push(d);
  return d;
};

interface Result {
  stdout: string;
  status: number;
}

const run = (env: Record<string, string>): Result => {
  try {
    const stdout = execFileSync(process.execPath, [script], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, ...env },
    });
    return { stdout, status: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (e.stdout ?? '') + (e.stderr ?? ''), status: e.status ?? -1 };
  }
};

/**
 * Built output rather than sources: the thing shipped to a user is a compiled
 * CLI, and the failure this guards against was a path that was right in the
 * repo and wrong on the machine.
 */
describe('focusreels doctor', () => {
  it('fails, and names the file, when a hook points at a script that is gone', () => {
    const dir = temp();
    const settings = join(dir, 'settings.json');
    const missing = join(dir, 'gone', 'focusreels-claude-hook.sh');
    writeFileSync(
      settings,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: `/bin/sh '${missing}' ended` }] }] },
      }),
    );

    const result = run({
      FOCUSREELS_CLAUDE_SETTINGS: settings,
      FOCUSREELS_CURSOR_HOOKS: join(dir, 'no-cursor.json'),
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('does not exist');
    expect(result.stdout).toContain(missing);
    expect(result.stdout).toContain('npm run install:claude');
  });

  it('fails when the hooks are present but produce no event', () => {
    const dir = temp();
    const settings = join(dir, 'settings.json');
    // A script that exists and does nothing: exactly the shape of a hook that
    // looks installed and is silent.
    const inert = join(dir, 'focusreels-inert.sh');
    writeFileSync(inert, '#!/bin/sh\nexit 0\n');
    writeFileSync(
      settings,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: `/bin/sh '${inert}' ended` }] }] },
      }),
    );

    const result = run({
      FOCUSREELS_CLAUDE_SETTINGS: settings,
      FOCUSREELS_CURSOR_HOOKS: join(dir, 'no-cursor.json'),
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('produced no event');
  });

  it('passes on hooks the installer just wrote', () => {
    const dir = temp();
    const settings = join(dir, 'settings.json');
    writeFileSync(settings, '{}');
    execFileSync('/bin/sh', [join(process.cwd(), 'adapters', 'install.sh'), 'claude-code', 'install'], {
      stdio: 'pipe',
      env: {
        ...process.env,
        FOCUSREELS_ADAPTER_HOME: join(dir, 'adapters'),
        FOCUSREELS_CLAUDE_SETTINGS: settings,
      },
    });

    const result = run({
      FOCUSREELS_CLAUDE_SETTINGS: settings,
      FOCUSREELS_CURSOR_HOOKS: join(dir, 'no-cursor.json'),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('really emits');
    expect(result.stdout).toContain('turn_started');
  });
});
