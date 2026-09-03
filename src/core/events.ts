/**
 * Event contract between IDE adapters and the app.
 *
 * PRIVACY INVARIANT: an event carries six metadata fields and nothing else.
 * No prompt, no response, no code, no file path, no project name.
 * `sanitizeEvent` is the single choke point that enforces this — every byte
 * arriving from an adapter goes through it before touching the rest of the app.
 */

/**
 * The sources this app ships adapters for. Used only for labels and defaults —
 * never for validation. Any tool may announce itself with an id of its own.
 */
export const BUILTIN_SOURCES = [
  'cursor',
  'vscode-copilot',
  'jetbrains',
  'claude-code',
  'demo',
] as const;
export type BuiltinSourceId = (typeof BUILTIN_SOURCES)[number];

/** A source id is a machine handle, so it has no room for a path or a sentence. */
export const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export type SourceId = string;

/**
 * How much the adapter actually knows. An `exact` adapter was told by an API;
 * a `heuristic` one inferred the turn from a process tree or a UI, and never
 * opens the window until the user allows that source.
 */
export const CONFIDENCES = ['exact', 'heuristic'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const EVENT_NAMES = ['turn_started', 'turn_progress', 'turn_ended'] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/** Outcomes reported by an adapter, plus the ones the app itself concludes. */
export const OUTCOMES = [
  'completed',
  'aborted',
  'error',
  'timeout', // watchdog fired, no adapter ever closed the turn
  'ide_closed', // the adapter/IDE went away mid-turn
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface TurnEvent {
  source: SourceId;
  turn_id: string;
  event: EventName;
  outcome: Outcome | null;
  timestamp: number;
  confidence: Confidence;
}

/** turn_id must be an opaque handle. Anything richer is a content-leak risk. */
const TURN_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export class InvalidEventError extends Error {}

function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

/**
 * Parse + whitelist. Returns a brand-new object built field by field, so no
 * extra key from the wire can ever survive into the app.
 */
export function sanitizeEvent(raw: unknown, now: number = Date.now()): TurnEvent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InvalidEventError('event must be a JSON object');
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.source !== 'string' || !SOURCE_ID_RE.test(r.source)) {
    throw new InvalidEventError('source must be an id matching [a-z0-9][a-z0-9-]{0,31}');
  }
  if (!isOneOf(EVENT_NAMES, r.event)) {
    throw new InvalidEventError(`unknown event`);
  }
  if (typeof r.turn_id !== 'string' || !TURN_ID_RE.test(r.turn_id)) {
    throw new InvalidEventError('turn_id must be an opaque id matching [A-Za-z0-9._:-]{1,128}');
  }

  let outcome: Outcome | null = null;
  if (r.outcome !== undefined && r.outcome !== null && r.outcome !== '') {
    if (!isOneOf(OUTCOMES, r.outcome)) throw new InvalidEventError('unknown outcome');
    outcome = r.outcome;
  }
  if (r.event === 'turn_ended' && outcome === null) {
    // A close with no stated outcome is treated as a normal completion rather
    // than dropped — losing the close would strand the overlay on screen.
    outcome = 'completed';
  }
  if (r.event !== 'turn_ended' && outcome !== null) {
    throw new InvalidEventError('outcome is only valid on turn_ended');
  }

  const ts = typeof r.timestamp === 'number' && Number.isFinite(r.timestamp) ? r.timestamp : now;

  let confidence: Confidence = 'exact';
  if (r.confidence !== undefined && r.confidence !== null && r.confidence !== '') {
    if (!isOneOf(CONFIDENCES, r.confidence)) throw new InvalidEventError('unknown confidence');
    confidence = r.confidence;
  }

  return {
    source: r.source,
    turn_id: r.turn_id,
    event: r.event,
    outcome,
    timestamp: ts,
    confidence,
  };
}

/** Namespaced key so two IDEs can't collide on a numeric turn_id. */
export function turnKey(e: Pick<TurnEvent, 'source' | 'turn_id'>): string {
  return `${e.source}#${e.turn_id}`;
}
