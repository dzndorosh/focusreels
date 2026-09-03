/**
 * Decides which sources may open turns, and keeps what we know about the ones
 * we have seen.
 *
 * Two stores, deliberately separate: the *policy* (may this source open turns)
 * is durable and lives in settings.json, written only when a source is first
 * seen or the user toggles it; the *liveness* (counters, last seen) is volatile
 * and lives here, because writing settings on every event would mean a disk
 * write per turn and would fight the hand-editable file.
 */

import type { Confidence, TurnEvent } from './events.js';

export interface SourcePolicy {
  enabled: boolean;
  confidence: Confidence;
}

export type BlockReason = 'disabled' | 'cap_reached';

export interface SourceVerdict {
  allowed: boolean;
  reason: BlockReason | null;
}

export interface SourceInfo {
  source: string;
  enabled: boolean;
  confidence: Confidence;
  firstSeenAt: number;
  lastSeenAt: number;
  events: number;
  droppedWhileDisabled: number;
}

/** An adapter emitting a fresh random id per event must not grow settings.json. */
export const MAX_SOURCES = 64;

export interface SourceRegistryOptions {
  getPolicies: () => Record<string, SourcePolicy>;
  /** persist a newly discovered source; called at most once per source */
  onRegister: (source: string, policy: SourcePolicy) => void;
  now?: () => number;
  max?: number;
}

interface Liveness {
  firstSeenAt: number;
  lastSeenAt: number;
  events: number;
  droppedWhileDisabled: number;
}

export class SourceRegistry {
  private readonly liveness = new Map<string, Liveness>();
  private readonly now: () => number;
  private readonly max: number;
  /** events refused because the cap was already full */
  private _capRejected = 0;

  constructor(private readonly opts: SourceRegistryOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.max = opts.max ?? MAX_SOURCES;
  }

  get capRejected(): number {
    return this._capRejected;
  }

  admit(event: TurnEvent): SourceVerdict {
    const policies = this.opts.getPolicies();
    let policy = policies[event.source];

    if (!policy) {
      if (Object.keys(policies).length >= this.max) {
        this._capRejected += 1;
        return { allowed: false, reason: 'cap_reached' };
      }
      // An adapter that was deliberately installed and claims to know gets to
      // work immediately; a guess waits for the user.
      policy = { enabled: event.confidence === 'exact', confidence: event.confidence };
      this.opts.onRegister(event.source, policy);
    }

    const at = this.now();
    const live = this.liveness.get(event.source) ?? {
      firstSeenAt: at,
      lastSeenAt: at,
      events: 0,
      droppedWhileDisabled: 0,
    };
    live.lastSeenAt = at;
    live.events += 1;
    if (!policy.enabled) live.droppedWhileDisabled += 1;
    this.liveness.set(event.source, live);

    return policy.enabled ? { allowed: true, reason: null } : { allowed: false, reason: 'disabled' };
  }

  /** Everything the menu bar and, later, `doctor` need to show. */
  list(): SourceInfo[] {
    const policies = this.opts.getPolicies();
    const ids = new Set([...Object.keys(policies), ...this.liveness.keys()]);
    return [...ids].sort().map((source) => {
      const policy = policies[source] ?? { enabled: false, confidence: 'exact' as Confidence };
      const live = this.liveness.get(source);
      return {
        source,
        enabled: policy.enabled,
        confidence: policy.confidence,
        firstSeenAt: live?.firstSeenAt ?? 0,
        lastSeenAt: live?.lastSeenAt ?? 0,
        events: live?.events ?? 0,
        droppedWhileDisabled: live?.droppedWhileDisabled ?? 0,
      };
    });
  }
}
