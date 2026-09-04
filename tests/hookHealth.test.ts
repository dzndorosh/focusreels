import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { brokenHooksLine, findBrokenHooks } from '../src/app/hookHealth.js';

const directories: string[] = [];
afterEach(() => {
  for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.FOCUSREELS_CLAUDE_SETTINGS;
  delete process.env.FOCUSREELS_CURSOR_HOOKS;
});

const home = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'fr-home-'));
  directories.push(d);
  mkdirSync(join(d, '.claude'), { recursive: true });
  process.env.FOCUSREELS_CLAUDE_SETTINGS = join(d, '.claude', 'settings.json');
  process.env.FOCUSREELS_CURSOR_HOOKS = join(d, '.cursor', 'hooks.json');
  return d;
};

const writeClaude = (dir: string, script: string) =>
  writeFileSync(
    join(dir, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: `/bin/sh '${script}' ended` }] }] },
    }),
  );

describe('findBrokenHooks', () => {
  it('finds the hook that points at a script that is gone', () => {
    const dir = home();
    writeClaude(dir, join(dir, 'gone', 'focusreels-claude-hook.sh'));

    const problems = findBrokenHooks(dir);
    expect(problems).toHaveLength(1);
    expect(brokenHooksLine(problems)).toContain('claude-code');
    expect(brokenHooksLine(problems)).toContain('npm run doctor');
  });

  it('says nothing when the script is there', () => {
    const dir = home();
    const script = join(dir, 'focusreels-claude-hook.sh');
    writeFileSync(script, '#!/bin/sh\n');
    writeClaude(dir, script);

    expect(findBrokenHooks(dir)).toEqual([]);
    expect(brokenHooksLine([])).toBeNull();
  });

  it('stays quiet when there is no config at all', () => {
    const dir = home();
    expect(findBrokenHooks(dir)).toEqual([]);
  });
});
