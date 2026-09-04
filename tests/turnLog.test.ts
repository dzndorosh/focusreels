import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TurnLog, formatSummary, parseRecords, summarize, type TurnRecord } from '../src/app/turnLog.js';
import type { TurnInfo } from '../src/core/turnRegistry.js';

const directories: string[] = [];
afterEach(() => {
  for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
});

const logPath = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'fr-log-'));
  directories.push(d);
  return join(d, 'turns.jsonl');
};

const info = (over: Partial<TurnInfo> = {}): TurnInfo => ({
  key: 'cursor#t1',
  source: 'cursor',
  turnId: 't1',
  state: 'waiting',
  outcome: null,
  hideMode: 'full-completion',
  startedAt: 1_000,
  ...over,
});

const record = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  t: 10_000,
  source: 'cursor',
  outcome: 'completed',
  ms: 4_000,
  shown: true,
  ...over,
});

describe('TurnLog', () => {
  it('writes one record per finished turn, and never the turn id', () => {
    const path = logPath();
    const log = new TurnLog(path);

    log.observe(info({ state: 'waiting' }), 1_000);
    log.observe(info({ state: 'active' }), 1_500);
    log.observe(info({ state: 'ended', outcome: 'completed' }), 6_000);

    const written = parseRecords(readFileSync(path, 'utf8'));
    expect(written).toEqual([
      { t: 6_000, source: 'cursor', outcome: 'completed', ms: 5_000, shown: true },
    ]);
    expect(readFileSync(path, 'utf8')).not.toContain('t1');
  });

  it('records a turn that was never on screen as not shown', () => {
    const path = logPath();
    const log = new TurnLog(path);

    // Answered inside the grace window: it never reached `active`.
    log.observe(info({ state: 'waiting' }), 1_000);
    log.observe(info({ state: 'ended', outcome: 'completed' }), 1_200);

    expect(parseRecords(readFileSync(path, 'utf8'))[0]!.shown).toBe(false);
  });

  it('does not carry the shown flag from one turn into the next on the same key', () => {
    const path = logPath();
    const log = new TurnLog(path);

    log.observe(info({ state: 'active' }), 1_000);
    log.observe(info({ state: 'ended', outcome: 'completed' }), 2_000);
    // Adapters reuse conversation ids, so the same key opens again.
    log.observe(info({ state: 'waiting', startedAt: 3_000 }), 3_000);
    log.observe(info({ state: 'ended', outcome: 'completed', startedAt: 3_000 }), 3_100);

    const written = parseRecords(readFileSync(path, 'utf8'));
    expect(written.map((r) => r.shown)).toEqual([true, false]);
  });

  it('keeps counting across a restart', () => {
    const path = logPath();
    const first = new TurnLog(path);
    first.observe(info({ state: 'ended', outcome: 'completed' }), 5_000);

    const second = new TurnLog(path);
    second.observe(info({ state: 'ended', outcome: 'timeout' }), 6_000);

    expect(second.summary(6_000).total).toBe(2);
  });

  it('survives a half-written last line from a crash', () => {
    expect(parseRecords('{"t":1,"source":"a","outcome":"completed","ms":2}\n{"t":3,"sour')).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('counts only the last 24 hours', () => {
    const now = 100 * 60 * 60 * 1000;
    const summary = summarize(
      [record({ t: now - 1_000 }), record({ t: now - 25 * 60 * 60 * 1000 })],
      now,
    );
    expect(summary.total).toBe(1);
  });

  it('calls out the turns nobody closed, because that is the app being wrong', () => {
    const now = 10_000;
    const summary = summarize(
      [record({ t: now }), record({ t: now, outcome: 'timeout' }), record({ t: now, outcome: 'timeout' })],
      now,
    );

    expect(summary.timedOut).toBe(2);
    expect(formatSummary(summary)).toContain('2 timed out');
  });

  it('says nothing happened rather than showing zeroes', () => {
    expect(formatSummary(summarize([], 0))).toBe('No turns in the last 24h');
  });

  it('reports a median duration a human can read', () => {
    const now = 10_000;
    const summary = summarize([1_000, 4_000, 9_000].map((ms) => record({ t: now, ms })), now);
    expect(summary.medianMs).toBe(4_000);
    expect(formatSummary(summary)).toContain('median 4s');
  });
});
