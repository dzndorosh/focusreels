import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'focusreels-installer-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    adapterHome: join(directory, 'FocusReels', 'adapters'),
    claudeSettings: join(directory, 'claude', 'settings.json'),
    cursorHooks: join(directory, 'cursor', 'hooks.json'),
  };
}

function install(target: string, operation: string, paths: ReturnType<typeof setup>) {
  return spawnSync('/bin/sh', [join(root, 'adapters/install.sh'), target, operation], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: paths.directory,
      FOCUSREELS_ADAPTER_HOME: paths.adapterHome,
      FOCUSREELS_CLAUDE_SETTINGS: paths.claudeSettings,
      FOCUSREELS_CURSOR_HOOKS: paths.cursorHooks,
    },
  });
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
}

describe('adapter installer', () => {
  it('installs Claude Code hooks next to the app without Node or a checkout path', () => {
    const paths = setup();
    mkdirSync(join(paths.directory, 'claude'), { recursive: true });
    writeFileSync(paths.claudeSettings, JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/usr/local/bin/other-hook' }] }] },
    }));

    const first = install('claude-code', 'install', paths);
    const second = install('claude-code', 'install', paths);
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);

    const settings = readJson(paths.claudeSettings);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('/usr/local/bin/other-hook');
    for (const event of ['UserPromptSubmit', 'Stop', 'StopFailure']) {
      const ours = settings.hooks[event].flatMap((group: any) => group.hooks)
        .filter((hook: any) => hook.command.includes('focusreels-claude-hook.sh'));
      expect(ours).toHaveLength(1);
      expect(ours[0].command).toContain(paths.adapterHome);
      expect(ours[0].command).not.toContain('node');
      expect(ours[0].command).not.toContain('dist/cli');
    }
    expect(statSync(join(paths.adapterHome, 'claude-code/focusreels-claude-hook.sh')).mode & 0o111).not.toBe(0);

    expect(install('claude-code', 'uninstall', paths).status).toBe(0);
    const afterRemoval = readJson(paths.claudeSettings);
    expect(afterRemoval.hooks.Stop[0].hooks[0].command).toBe('/usr/local/bin/other-hook');
    expect(JSON.stringify(afterRemoval)).not.toContain('focusreels-claude-hook.sh');
  });

  it('merges idempotent Cursor hooks and writes a portable VS Code template', () => {
    const paths = setup();
    mkdirSync(join(paths.directory, 'cursor'), { recursive: true });
    writeFileSync(paths.cursorHooks, JSON.stringify({
      version: 1,
      hooks: { stop: [{ command: '/usr/local/bin/other-hook' }] },
    }));

    const first = install('cursor', 'install', paths);
    const second = install('cursor', 'install', paths);
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    const cursor = readJson(paths.cursorHooks);
    expect(cursor.hooks.stop).toContainEqual({ command: '/usr/local/bin/other-hook' });
    for (const event of ['beforeSubmitPrompt', 'stop']) {
      expect(cursor.hooks[event].filter((hook: any) => hook.command.includes('focusreels-cursor-hook.sh'))).toHaveLength(1);
    }

    expect(install('vscode-copilot', 'install', paths).status).toBe(0);
    const vscode = readJson(join(paths.adapterHome, 'vscode-copilot', 'hooks.json'));
    expect(vscode.hooks.UserPromptSubmit[0].command).toContain(paths.adapterHome);
    expect(vscode.hooks.UserPromptSubmit[0].command).not.toContain('node');
  });
});
