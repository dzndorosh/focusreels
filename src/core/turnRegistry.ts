/**
 * Owns every in-flight turn and translates the machines' effects into real
 * timers and one piece of observable output: should the overlay be on screen.
 *
 * Parallel requests are the normal case (two IDEs, or one IDE with two chats),
 * so visibility is the OR over all machines: the overlay stays up while any
 * turn is still `active`, and drops the moment the last one ends.
 */

import { turnKey, type Outcome, type SourceId, type TurnEvent } from './events.js';
import {
  DEFAULT_MACHINE_CONFIG,
  TurnStateMachine,
  type Effect,
  type HideMode,
  type MachineConfig,
  type MachineInput,
  type TurnState,
} from './turnStateMachine.js';

export interface RegistryConfig extends MachineConfig {
  /** an IDE the user switched off never opens a turn at all */
  enabledSources: Record<SourceId, boolean>;
}

export const DEFAULT_REGISTRY_CONFIG: RegistryConfig = {
  ...DEFAULT_MACHINE_CONFIG,
  enabledSources: {
    cursor: true,
    'vscode-copilot': true,
    jetbrains: true,
    'claude-code': true,
    demo: true,
  },
};

/** Injected so tests can drive time by hand. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export const systemTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface TurnInfo {
  key: string;
  source: SourceId;
  turnId: string;
  state: TurnState;
  outcome: Outcome | null;
  hideMode: HideMode;
  startedAt: number | null;
}

interface Entry {
  machine: TurnStateMachine;
  source: SourceId;
  turnId: string;
  hideMode: HideMode;
  showHandle: unknown;
  watchdogHandle: unknown;
}

export interface RegistryOptions {
  /** read fresh on every new turn, so settings changes apply to the next turn */
  getConfig?: () => RegistryConfig;
  timers?: Timers;
  onVisibilityChange?: (visible: boolean) => void;
  onTurnChange?: (info: TurnInfo) => void;
}

export class TurnRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly getConfig: () => RegistryConfig;
  private readonly timers: Timers;
  private readonly onVisibilityChange: (visible: boolean) => void;
  private readonly onTurnChange: (info: TurnInfo) => void;
  private _visible = false;

  constructor(opts: RegistryOptions = {}) {
    this.getConfig = opts.getConfig ?? (() => DEFAULT_REGISTRY_CONFIG);
    this.timers = opts.timers ?? systemTimers;
    this.onVisibilityChange = opts.onVisibilityChange ?? (() => {});
    this.onTurnChange = opts.onTurnChange ?? (() => {});
  }

  get visible(): boolean {
    return this._visible;
  }

  /** turns currently held (waiting or active) */
  get size(): number {
    return this.entries.size;
  }

  list(): TurnInfo[] {
    return [...this.entries.values()].map((e) => this.infoOf(e));
  }

  private infoOf(e: Entry): TurnInfo {
    return {
      key: e.machine.key,
      source: e.source,
      turnId: e.turnId,
      state: e.machine.state,
      outcome: e.machine.outcome,
      hideMode: e.hideMode,
      startedAt: e.machine.snapshot().startedAt,
    };
  }

  /** Entry point for anything arriving from the broker. */
  dispatch(event: TurnEvent): void {
    const key = turnKey(event);
    let entry = this.entries.get(key);

    if (!entry) {
      // Only a start opens a turn. A stray progress/end for an unknown turn is
      // dropped here rather than creating a machine that can never be shown.
      if (event.event !== 'turn_started') return;

      const cfg = this.getConfig();
      if (!cfg.enabledSources[event.source]) return;

      entry = {
        machine: new TurnStateMachine(key, {
          showDelayMs: cfg.showDelayMs,
          watchdogMs: cfg.watchdogMs,
          hideMode: cfg.hideMode,
        }),
        source: event.source,
        turnId: event.turn_id,
        hideMode: cfg.hideMode,
        showHandle: null,
        watchdogHandle: null,
      };
      this.entries.set(key, entry);
    }

    this.send(entry, { kind: 'event', event });
  }

  /** End every turn from one source — the IDE quit, or the user disabled it. */
  cancelSource(source: SourceId, outcome: Extract<Outcome, 'aborted' | 'ide_closed'>): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.source === source) this.send(entry, { kind: 'cancel', outcome });
    }
  }

  cancelAll(outcome: Extract<Outcome, 'aborted' | 'ide_closed'> = 'aborted'): void {
    for (const entry of [...this.entries.values()]) {
      this.send(entry, { kind: 'cancel', outcome });
    }
  }

  private send(entry: Entry, input: MachineInput): void {
    const t = entry.machine.send(input, this.timers.now());
    if (t.ignored) return;

    for (const effect of t.effects) this.apply(entry, effect);

    this.onTurnChange(this.infoOf(entry));

    if (entry.machine.isTerminal) {
      // Dropped immediately, not tombstoned: adapters reuse conversation ids
      // across turns, so the same key must be free to open again.
      this.entries.delete(entry.machine.key);
    }
    this.recomputeVisibility();
  }

  private apply(entry: Entry, effect: Effect): void {
    switch (effect.type) {
      case 'arm_show_timer':
        entry.showHandle = this.timers.setTimeout(
          () => this.send(entry, { kind: 'show_timer' }),
          effect.delayMs,
        );
        break;
      case 'cancel_show_timer':
        if (entry.showHandle !== null) this.timers.clearTimeout(entry.showHandle);
        entry.showHandle = null;
        break;
      case 'arm_watchdog':
        entry.watchdogHandle = this.timers.setTimeout(
          () => this.send(entry, { kind: 'watchdog' }),
          effect.delayMs,
        );
        break;
      case 'cancel_watchdog':
        if (entry.watchdogHandle !== null) this.timers.clearTimeout(entry.watchdogHandle);
        entry.watchdogHandle = null;
        break;
      case 'show_overlay':
      case 'hide_overlay':
        // Visibility is derived, never commanded: with parallel turns a single
        // machine's hide must not close an overlay another turn still needs.
        break;
    }
  }

  private recomputeVisibility(): void {
    const next = [...this.entries.values()].some((e) => e.machine.wantsOverlay);
    if (next === this._visible) return;
    this._visible = next;
    this.onVisibilityChange(next);
  }
}
