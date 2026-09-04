import { describe, expect, it } from 'vitest';
import { formatSourceLine } from '../src/app/sourceLine.js';
import type { SourceInfo } from '../src/core/sourceRegistry.js';

const NOW = 1_000 * 60 * 60 * 24 * 400;

const info = (over: Partial<SourceInfo> = {}): SourceInfo => ({
  source: 'cursor',
  enabled: true,
  confidence: 'exact',
  firstSeenAt: NOW,
  lastSeenAt: NOW,
  events: 1,
  droppedWhileDisabled: 0,
  ...over,
});

describe('formatSourceLine', () => {
  it('says so when a source has never been heard from', () => {
    expect(formatSourceLine(info({ events: 0, lastSeenAt: 0 }), 'JetBrains AI', NOW)).toBe(
      'JetBrains AI — no events yet',
    );
  });

  it('explains a source whose every event was discarded', () => {
    const line = formatSourceLine(
      info({ enabled: false, events: 4, droppedWhileDisabled: 4 }),
      'Cursor',
      NOW,
    );
    expect(line).toBe('Cursor — 4 event(s) ignored, switched off');
  });

  it('reports a working source by how recently it spoke', () => {
    expect(formatSourceLine(info({ lastSeenAt: NOW - 30_000 }), 'Cursor', NOW)).toBe(
      'Cursor — active just now',
    );
    expect(formatSourceLine(info({ lastSeenAt: NOW - 3 * 60 * 60_000 }), 'Cursor', NOW)).toBe(
      'Cursor — active 3h ago',
    );
  });

  it('stops calling a source active once it has been quiet for a week', () => {
    const line = formatSourceLine(info({ lastSeenAt: NOW - 9 * 24 * 60 * 60_000 }), 'Cursor', NOW);
    expect(line).toBe('Cursor — last seen 9d ago');
  });

  it('marks a guessing adapter as a guess', () => {
    expect(formatSourceLine(info({ confidence: 'heuristic', events: 0 }), 'JetBrains AI', NOW)).toBe(
      'JetBrains AI (guess) — no events yet',
    );
  });
});
