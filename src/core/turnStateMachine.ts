/**
 * One turn = one AI request in one IDE. Pure, synchronous, no I/O, no timers.
 * Timers live in the registry; the machine only *asks* for them via effects.
 *
 *   idle --turn_started--> waiting --show_timer--> active --turn_ended--> ended
 *                             |                      |
 *                             +----turn_ended--------+--> ended   (never shown)
 *
 * `waiting` is the sub-500ms grace window: a fast answer must never flash an
 * overlay. `active` is the only state in which the overlay is on screen.
 */

import type { EventName, Outcome, TurnEvent } from './events.js';

export type TurnState = 'idle' | 'waiting' | 'active' | 'ended';

export type HideMode =
  /** hide as soon as the agent produces its first output */
  | 'first-response'
  /** hide only when the whole turn is finished */
  | 'full-completion';

export interface MachineConfig {
  /** don't show the overlay before the wait has lasted this long */
  showDelayMs: number;
  /** give up on a turn that never closes */
  watchdogMs: number;
  hideMode: HideMode;
}

export const DEFAULT_MACHINE_CONFIG: MachineConfig = {
  showDelayMs: 500,
  watchdogMs: 10 * 60 * 1000,
  hideMode: 'full-completion',
};

export type MachineInput =
  | { kind: 'event'; event: TurnEvent }
  /** the show-delay timer elapsed */
  | { kind: 'show_timer' }
  /** the watchdog elapsed */
  | { kind: 'watchdog' }
  /** user hit cancel / IDE quit / app is shutting down */
  | { kind: 'cancel'; outcome: Extract<Outcome, 'aborted' | 'ide_closed'> };

export type Effect =
  | { type: 'arm_show_timer'; delayMs: number }
  | { type: 'cancel_show_timer' }
  | { type: 'arm_watchdog'; delayMs: number }
  | { type: 'cancel_watchdog' }
  | { type: 'show_overlay' }
  | { type: 'hide_overlay' };

export interface Transition {
  state: TurnState;
  effects: Effect[];
  /** set once, when the turn reaches `ended` */
  outcome: Outcome | null;
  /** true when the input caused no state change and no effects */
  ignored: boolean;
}

export interface TurnSnapshot {
  state: TurnState;
  outcome: Outcome | null;
  startedAt: number | null;
  endedAt: number | null;
}

const NOOP = (state: TurnState, outcome: Outcome | null): Transition => ({
  state,
  effects: [],
  outcome,
  ignored: true,
});

export class TurnStateMachine {
  private _state: TurnState = 'idle';
  private _outcome: Outcome | null = null;
  private _startedAt: number | null = null;
  private _endedAt: number | null = null;

  constructor(
    readonly key: string,
    private readonly config: MachineConfig = DEFAULT_MACHINE_CONFIG,
  ) {}

  get state(): TurnState {
    return this._state;
  }
  get outcome(): Outcome | null {
    return this._outcome;
  }
  /** the overlay is on screen exactly while at least one machine says true */
  get wantsOverlay(): boolean {
    return this._state === 'active';
  }
  get isTerminal(): boolean {
    return this._state === 'ended';
  }

  snapshot(): TurnSnapshot {
    return {
      state: this._state,
      outcome: this._outcome,
      startedAt: this._startedAt,
      endedAt: this._endedAt,
    };
  }

  send(input: MachineInput, now: number): Transition {
    const t = this.next(input, now);
    this._state = t.state;
    this._outcome = t.outcome;
    return t;
  }

  private end(outcome: Outcome, now: number, wasVisible: boolean): Transition {
    this._endedAt = now;
    const effects: Effect[] = [{ type: 'cancel_show_timer' }, { type: 'cancel_watchdog' }];
    if (wasVisible) effects.push({ type: 'hide_overlay' });
    return { state: 'ended', effects, outcome, ignored: false };
  }

  private next(input: MachineInput, now: number): Transition {
    const s = this._state;

    // `ended` is absorbing: late duplicates from a chatty adapter are dropped.
    if (s === 'ended') return NOOP('ended', this._outcome);

    if (input.kind === 'cancel') {
      if (s === 'idle') return NOOP(s, this._outcome);
      return this.end(input.outcome, now, s === 'active');
    }

    if (input.kind === 'watchdog') {
      if (s !== 'waiting' && s !== 'active') return NOOP(s, this._outcome);
      return this.end('timeout', now, s === 'active');
    }

    if (input.kind === 'show_timer') {
      if (s !== 'waiting') return NOOP(s, this._outcome);
      return {
        state: 'active',
        effects: [{ type: 'show_overlay' }],
        outcome: null,
        ignored: false,
      };
    }

    const name: EventName = input.event.event;

    if (name === 'turn_started') {
      if (s !== 'idle') return NOOP(s, this._outcome); // re-send of the same turn
      this._startedAt = now;
      return {
        state: 'waiting',
        effects: [
          { type: 'arm_show_timer', delayMs: this.config.showDelayMs },
          { type: 'arm_watchdog', delayMs: this.config.watchdogMs },
        ],
        outcome: null,
        ignored: false,
      };
    }

    if (name === 'turn_progress') {
      // The agent produced something. In 'first-response' mode that is the
      // moment the user's attention is worth something again.
      if (this.config.hideMode !== 'first-response') return NOOP(s, this._outcome);
      if (s !== 'waiting' && s !== 'active') return NOOP(s, this._outcome);
      return this.end('completed', now, s === 'active');
    }

    // turn_ended
    if (s === 'idle') {
      // A close for a turn we never saw open (app started mid-turn). Swallow it
      // rather than let it open anything.
      return NOOP('ended', input.event.outcome ?? 'completed');
    }
    return this.end(input.event.outcome ?? 'completed', now, s === 'active');
  }
}
