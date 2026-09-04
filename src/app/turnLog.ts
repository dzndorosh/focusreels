/**
 * An append-only record of how turns ended.
 *
 * The product is one mechanic, and until now nothing in it could answer the
 * only question that matters about that mechanic: how often does it get the
 * moment right? Whether the watchdogs fire once a week or once an hour, whether
 * turns are being cut short or left hanging — all of it was guesswork, argued
 * from intuition. This makes it countable.
 *
 * The same privacy rule as everywhere else, and for the same reason: a turn is
 * six pieces of metadata. `turn_id` is deliberately *not* written — it is
 * opaque to us, but it is a session id to whoever issued it, and a log file
 * outlives the run that produced it.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Outcome } from '../core/events.js';
import type { TurnInfo } from '../core/turnRegistry.js';

export interface TurnRecord {
  /** when the turn ended */
  t: number;
  source: string;
  outcome: Outcome;
  /** how long the turn lasted, ms */
  ms: number;
  /** whether the overlay was ever actually on screen for it */
  shown: boolean;
}

/** Trim well before a log file becomes something anyone has to think about. */
const MAX_RECORDS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseRecords(text: string): TurnRecord[] {
  const records: TurnRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Partial<TurnRecord>;
      if (
        typeof value.t === 'number' &&
        typeof value.source === 'string' &&
        typeof value.outcome === 'string' &&
        typeof value.ms === 'number'
      ) {
        records.push({
          t: value.t,
          source: value.source,
          outcome: value.outcome as Outcome,
          ms: value.ms,
          shown: value.shown === true,
        });
      }
    } catch {
      // A half-written last line after a crash. Skip it; the rest is still data.
    }
  }
  return records;
}

export interface Summary {
  total: number;
  shown: number;
  /** the ones that ended because nobody closed them — the health number */
  timedOut: number;
  medianMs: number;
}

export function summarize(records: TurnRecord[], now: number, windowMs = DAY_MS): Summary {
  const recent = records.filter((r) => now - r.t <= windowMs);
  const durations = recent.map((r) => r.ms).sort((a, b) => a - b);
  const middle = durations.length === 0 ? 0 : (durations[durations.length >> 1] ?? 0);

  return {
    total: recent.length,
    shown: recent.filter((r) => r.shown).length,
    timedOut: recent.filter((r) => r.outcome === 'timeout').length,
    medianMs: middle,
  };
}

/**
 * The menu-bar line. `timeout` is called out on its own because it is the only
 * outcome that means the app got it wrong rather than the agent finishing.
 */
export function formatSummary(summary: Summary): string {
  if (summary.total === 0) return 'No turns in the last 24h';
  const parts = [`${summary.total} turn(s) in 24h`, `${summary.shown} shown`];
  if (summary.timedOut > 0) parts.push(`${summary.timedOut} timed out`);
  parts.push(`median ${Math.round(summary.medianMs / 100) / 10}s`);
  return parts.join(' · ');
}

export class TurnLog {
  /** keys whose overlay was on screen at some point during the turn */
  private readonly wasShown = new Set<string>();
  private records: TurnRecord[] = [];

  constructor(private readonly path: string) {
    try {
      this.records = parseRecords(readFileSync(this.path, 'utf8'));
    } catch {
      this.records = [];
    }
  }

  /** Subscribe this to the registry's `onTurnChange`. */
  observe(info: TurnInfo, now = Date.now()): void {
    if (info.state === 'active') this.wasShown.add(info.key);
    if (info.state !== 'ended') return;

    const record: TurnRecord = {
      t: now,
      source: info.source,
      outcome: info.outcome ?? 'completed',
      ms: info.startedAt === null ? 0 : Math.max(0, now - info.startedAt),
      shown: this.wasShown.has(info.key),
    };
    this.wasShown.delete(info.key);
    this.records.push(record);
    this.append(record);
  }

  summary(now = Date.now()): Summary {
    return summarize(this.records, now);
  }

  private append(record: TurnRecord): void {
    const line = JSON.stringify(record) + '\n';
    try {
      if (this.records.length > MAX_RECORDS) {
        // Rewrite rather than grow: keep the newer half, which is the half
        // anyone would look at.
        this.records = this.records.slice(-Math.floor(MAX_RECORDS / 2));
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, this.records.map((r) => JSON.stringify(r)).join('\n') + '\n');
        return;
      }
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, line);
    } catch {
      // A log that cannot be written must never take the overlay down with it.
    }
  }
}
