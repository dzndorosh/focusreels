import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeEvent, type SourceId, type TurnEvent } from '../src/core/events.js';
import {
  DEFAULT_REGISTRY_CONFIG,
  TurnRegistry,
  type RegistryConfig,
} from '../src/core/turnRegistry.js';
import { FakeTimers } from './fakeTimers.js';

const ev = (
  source: SourceId,
  turn_id: string,
  event: string,
  outcome?: string,
): TurnEvent => sanitizeEvent({ source, turn_id, event, outcome, timestamp: 0 });

describe('TurnRegistry', () => {
  let timers: FakeTimers;
  let visibility: boolean[];
  let config: RegistryConfig;

  const build = () =>
    new TurnRegistry({
      timers,
      getConfig: () => config,
      onVisibilityChange: (v) => visibility.push(v),
    });

  beforeEach(() => {
    timers = new FakeTimers();
    visibility = [];
    config = { ...DEFAULT_REGISTRY_CONFIG };
  });

  it('shows the overlay only after the delay has actually elapsed', () => {
    const r = build();
    r.dispatch(ev('cursor', 't1', 'turn_started'));
    timers.advance(499);
    expect(r.visible).toBe(false);

    timers.advance(1);
    expect(r.visible).toBe(true);
    expect(visibility).toEqual([true]);
  });

  it('stays silent for a turn answered in under 500ms', () => {
    const r = build();
    r.dispatch(ev('cursor', 't1', 'turn_started'));
    timers.advance(200);
    r.dispatch(ev('cursor', 't1', 'turn_ended', 'completed'));
    timers.advance(5000);

    expect(r.visible).toBe(false);
    expect(visibility).toEqual([]);
    expect(timers.pending).toBe(0);
    expect(r.size).toBe(0);
  });

  it('keeps the overlay up until the LAST parallel turn ends', () => {
    const r = build();
    r.dispatch(ev('cursor', 'a', 'turn_started'));
    r.dispatch(ev('jetbrains', 'b', 'turn_started'));
    timers.advance(500);
    expect(r.visible).toBe(true);

    r.dispatch(ev('cursor', 'a', 'turn_ended', 'completed'));
    expect(r.visible).toBe(true); // jetbrains is still working

    r.dispatch(ev('jetbrains', 'b', 'turn_ended', 'completed'));
    expect(r.visible).toBe(false);
    expect(visibility).toEqual([true, false]);
  });

  it('does not confuse the same turn_id coming from two IDEs', () => {
    const r = build();
    r.dispatch(ev('cursor', '1', 'turn_started'));
    r.dispatch(ev('vscode-copilot', '1', 'turn_started'));
    expect(r.size).toBe(2);
  });

  it('lets a source reuse a turn_id on the next turn', () => {
    const r = build();
    r.dispatch(ev('cursor', 'conv-1', 'turn_started'));
    timers.advance(500);
    r.dispatch(ev('cursor', 'conv-1', 'turn_ended', 'completed'));
    expect(r.size).toBe(0);

    r.dispatch(ev('cursor', 'conv-1', 'turn_started'));
    timers.advance(500);
    expect(r.visible).toBe(true);
  });

  it('ignores every source the user switched off', () => {
    config = { ...config, enabledSources: { ...config.enabledSources, jetbrains: false } };
    const r = build();
    r.dispatch(ev('jetbrains', 't1', 'turn_started'));
    timers.advance(5000);
    expect(r.size).toBe(0);
    expect(r.visible).toBe(false);
  });

  it('drops an end or progress event for a turn it never opened', () => {
    const r = build();
    r.dispatch(ev('cursor', 'ghost', 'turn_ended', 'completed'));
    r.dispatch(ev('cursor', 'ghost', 'turn_progress'));
    timers.advance(5000);
    expect(r.size).toBe(0);
    expect(visibility).toEqual([]);
  });

  it('hides the overlay when the watchdog fires on a stuck turn', () => {
    config = { ...config, watchdogMs: 2000 };
    const r = build();
    r.dispatch(ev('cursor', 't1', 'turn_started'));
    timers.advance(500);
    expect(r.visible).toBe(true);

    timers.advance(1500);
    expect(r.visible).toBe(false);
    expect(r.size).toBe(0);
  });

  it('closing an IDE ends only that IDE turns', () => {
    const r = build();
    r.dispatch(ev('cursor', 'a', 'turn_started'));
    r.dispatch(ev('jetbrains', 'b', 'turn_started'));
    timers.advance(500);

    r.cancelSource('cursor', 'ide_closed');
    expect(r.visible).toBe(true);
    expect(r.list().map((t) => t.source)).toEqual(['jetbrains']);

    r.cancelAll('ide_closed');
    expect(r.visible).toBe(false);
    expect(r.size).toBe(0);
  });

  it('leaves no timer behind once every turn has ended', () => {
    const r = build();
    r.dispatch(ev('cursor', 'a', 'turn_started'));
    r.dispatch(ev('cursor', 'b', 'turn_started'));
    timers.advance(500);
    r.cancelAll('aborted');
    expect(timers.pending).toBe(0);
  });

  it('applies a settings change to the next turn, not the running one', () => {
    const r = build();
    r.dispatch(ev('cursor', 'a', 'turn_started'));
    config = { ...config, showDelayMs: 3000 };

    timers.advance(500);
    expect(r.visible).toBe(true); // the running turn kept its 500ms

    r.dispatch(ev('cursor', 'b', 'turn_started'));
    r.dispatch(ev('cursor', 'a', 'turn_ended', 'completed'));
    expect(r.visible).toBe(false);

    timers.advance(2999);
    expect(r.visible).toBe(false);
    timers.advance(1);
    expect(r.visible).toBe(true);
  });

  it('first-response mode hides on the first output', () => {
    config = { ...config, hideMode: 'first-response' };
    const r = build();
    r.dispatch(ev('cursor', 'a', 'turn_started'));
    timers.advance(500);
    expect(r.visible).toBe(true);

    r.dispatch(ev('cursor', 'a', 'turn_progress'));
    expect(r.visible).toBe(false);
  });
});
