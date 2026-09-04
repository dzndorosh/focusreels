import { describe, expect, it } from 'vitest';
import {
  auditRefs,
  claudeHookRefs,
  describeProblem,
  flatHookRefs,
  scriptPathOf,
} from '../src/doctor/audit.js';

const HOME = '/Users/someone';

describe('scriptPathOf', () => {
  it('reads the quoted path the installer writes', () => {
    const command = `/bin/sh '/Users/someone/Library/Application Support/FocusReels/adapters/claude-code/focusreels-claude-hook.sh' started`;
    expect(scriptPathOf(command, HOME)).toBe(
      '/Users/someone/Library/Application Support/FocusReels/adapters/claude-code/focusreels-claude-hook.sh',
    );
  });

  it('expands the home placeholders the templates use', () => {
    expect(scriptPathOf('$HOME/.focusreels/adapters/cursor/hook.sh started', HOME)).toBe(
      '/Users/someone/.focusreels/adapters/cursor/hook.sh',
    );
    expect(scriptPathOf('${userHome}/.focusreels/x/hook.sh ended', HOME)).toBe(
      '/Users/someone/.focusreels/x/hook.sh',
    );
  });

  it('admits when it cannot tell', () => {
    expect(scriptPathOf('some-other-focusreels-thing --flag', HOME)).toBeNull();
  });
});

describe('reading hooks out of a config', () => {
  it('finds only this app\'s hooks in a Claude Code settings file', () => {
    const settings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '/usr/local/bin/someone-elses-hook' }] },
          { hooks: [{ type: 'command', command: `/bin/sh '/a/focusreels-claude-hook.sh' ended` }] },
        ],
      },
    };
    const refs = claudeHookRefs(settings, HOME);
    expect(refs).toEqual([
      {
        target: 'claude-code',
        event: 'Stop',
        command: `/bin/sh '/a/focusreels-claude-hook.sh' ended`,
        scriptPath: '/a/focusreels-claude-hook.sh',
      },
    ]);
  });

  it('survives a hand-edited file of the wrong shape', () => {
    for (const junk of [null, 42, { hooks: 'nope' }, { hooks: { Stop: 'nope' } }, { hooks: { Stop: [1] } }]) {
      expect(claudeHookRefs(junk, HOME)).toEqual([]);
      expect(flatHookRefs(junk, 'cursor', HOME)).toEqual([]);
    }
  });

  it('reads the flat shape Cursor uses', () => {
    const config = { hooks: { stop: [{ command: '$HOME/x/focusreels-cursor-hook.sh ended' }] } };
    expect(flatHookRefs(config, 'cursor', HOME)).toMatchObject([
      { target: 'cursor', event: 'stop', scriptPath: '/Users/someone/x/focusreels-cursor-hook.sh' },
    ]);
  });
});

describe('auditRefs', () => {
  // The real failure this whole module exists for: the installer wrote a path
  // that later stopped existing, and nothing noticed for a long time.
  it('reports a hook whose script is gone', () => {
    const refs = claudeHookRefs(
      { hooks: { Stop: [{ hooks: [{ command: `/bin/sh '/gone/focusreels-claude-hook.sh' ended` }] }] } },
      HOME,
    );
    const problems = auditRefs(refs, () => false);

    expect(problems).toHaveLength(1);
    expect(problems[0]!.kind).toBe('missing_script');
    expect(describeProblem(problems[0]!)).toContain('does not exist');
    expect(describeProblem(problems[0]!)).toContain('/gone/focusreels-claude-hook.sh');
  });

  it('says nothing about hooks that are fine', () => {
    const refs = claudeHookRefs(
      { hooks: { Stop: [{ hooks: [{ command: `/bin/sh '/here/focusreels-claude-hook.sh' ended` }] }] } },
      HOME,
    );
    expect(auditRefs(refs, () => true)).toEqual([]);
  });

  it('flags a command it cannot read rather than passing it', () => {
    const refs = flatHookRefs({ hooks: { stop: [{ command: 'focusreels-magic' }] } }, 'cursor', HOME);
    expect(auditRefs(refs, () => true)[0]!.kind).toBe('unreadable_command');
  });
});
