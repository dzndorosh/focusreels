import { describe, expect, it } from 'vitest';
import { InvalidEventError, sanitizeEvent, turnKey } from '../src/core/events.js';

const base = { source: 'cursor', turn_id: 'abc-123', event: 'turn_started', timestamp: 42 };

describe('sanitizeEvent', () => {
  it('keeps exactly the five metadata fields', () => {
    const e = sanitizeEvent(base);
    expect(Object.keys(e).sort()).toEqual([
      'event',
      'outcome',
      'source',
      'timestamp',
      'turn_id',
    ]);
  });

  it('drops any content an adapter tries to smuggle in', () => {
    const e = sanitizeEvent({
      ...base,
      prompt: 'refactor the auth module',
      response: '...',
      file_path: '/Users/me/secret/app.ts',
      project: 'acme-internal',
    }) as Record<string, unknown>;
    expect(e.prompt).toBeUndefined();
    expect(e.response).toBeUndefined();
    expect(e.file_path).toBeUndefined();
    expect(e.project).toBeUndefined();
  });

  it('rejects a turn_id that could carry content', () => {
    expect(() => sanitizeEvent({ ...base, turn_id: '/Users/me/app.ts' })).toThrow(
      InvalidEventError,
    );
    expect(() => sanitizeEvent({ ...base, turn_id: 'x'.repeat(129) })).toThrow(InvalidEventError);
    expect(() => sanitizeEvent({ ...base, turn_id: '' })).toThrow(InvalidEventError);
  });

  it('rejects unknown sources, events and outcomes', () => {
    expect(() => sanitizeEvent({ ...base, source: 'nano' })).toThrow(InvalidEventError);
    expect(() => sanitizeEvent({ ...base, event: 'turn_paused' })).toThrow(InvalidEventError);
    expect(() =>
      sanitizeEvent({ ...base, event: 'turn_ended', outcome: 'exploded' }),
    ).toThrow(InvalidEventError);
  });

  it('defaults a bare turn_ended to completed', () => {
    expect(sanitizeEvent({ ...base, event: 'turn_ended' }).outcome).toBe('completed');
  });

  it('refuses an outcome on a non-terminal event', () => {
    expect(() => sanitizeEvent({ ...base, outcome: 'completed' })).toThrow(InvalidEventError);
  });

  it('falls back to the local clock when timestamp is missing or junk', () => {
    expect(sanitizeEvent({ ...base, timestamp: undefined }, 999).timestamp).toBe(999);
    expect(sanitizeEvent({ ...base, timestamp: 'now' }, 999).timestamp).toBe(999);
  });

  it('accepts claude-code, the source behind Claude Code and its GUI shells', () => {
    const e = sanitizeEvent({ ...base, source: 'claude-code', turn_id: 'sess-1' });
    expect(e.source).toBe('claude-code');
  });

  it('strips the fields a Claude Code hook payload actually carries', () => {
    // the real UserPromptSubmit shape: only session_id may survive, as turn_id
    const e = sanitizeEvent({
      source: 'claude-code',
      turn_id: 'abc123-def',
      event: 'turn_started',
      transcript_path: '/Users/me/.claude/projects/x.jsonl',
      cwd: '/Users/me/secret-project',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'delete everything in prod',
    }) as Record<string, unknown>;
    expect(e.cwd).toBeUndefined();
    expect(e.prompt).toBeUndefined();
    expect(e.transcript_path).toBeUndefined();
    expect(e.turn_id).toBe('abc123-def');
  });

  it('namespaces turn ids per source', () => {
    expect(turnKey({ source: 'cursor', turn_id: '1' })).not.toBe(
      turnKey({ source: 'jetbrains', turn_id: '1' }),
    );
  });
});
