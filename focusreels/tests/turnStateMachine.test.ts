import { describe, expect, it } from 'vitest';
import { sanitizeEvent, type Outcome, type TurnEvent } from '../src/core/events.js';
import {
  DEFAULT_MACHINE_CONFIG,
  TurnStateMachine,
  type Effect,
  type MachineConfig,
} from '../src/core/turnStateMachine.js';

const ev = (event: string, outcome?: Outcome): TurnEvent =>
  sanitizeEvent({ source: 'cursor', turn_id: 't1', event, outcome, timestamp: 0 });

const machine = (cfg: Partial<MachineConfig> = {}) =>
  new TurnStateMachine('cursor#t1', { ...DEFAULT_MACHINE_CONFIG, ...cfg });

const types = (effects: Effect[]) => effects.map((e) => e.type);

describe('TurnStateMachine', () => {
  it('walks idle -> waiting -> active -> ended', () => {
    const m = machine();
    expect(m.state).toBe('idle');

    const started = m.send({ kind: 'event', event: ev('turn_started') }, 0);
    expect(m.state).toBe('waiting');
    expect(types(started.effects)).toEqual(['arm_show_timer', 'arm_watchdog']);
    expect(started.effects[0]).toMatchObject({ delayMs: 500 });
    expect(m.wantsOverlay).toBe(false);

    const shown = m.send({ kind: 'show_timer' }, 500);
    expect(m.state).toBe('active');
    expect(types(shown.effects)).toEqual(['show_overlay']);
    expect(m.wantsOverlay).toBe(true);

    const ended = m.send({ kind: 'event', event: ev('turn_ended', 'completed') }, 3000);
    expect(m.state).toBe('ended');
    expect(m.outcome).toBe('completed');
    expect(types(ended.effects)).toContain('hide_overlay');
    expect(m.wantsOverlay).toBe(false);
  });

  it('never shows an overlay for a turn that finishes inside the grace window', () => {
    const m = machine();
    m.send({ kind: 'event', event: ev('turn_started') }, 0);
    const ended = m.send({ kind: 'event', event: ev('turn_ended', 'completed') }, 320);

    expect(m.state).toBe('ended');
    expect(types(ended.effects)).toEqual(['cancel_show_timer', 'cancel_watchdog']);
    expect(types(ended.effects)).not.toContain('hide_overlay');
    expect(types(ended.effects)).not.toContain('show_overlay');
  });

  it('a late show_timer after the turn ended does nothing', () => {
    const m = machine();
    m.send({ kind: 'event', event: ev('turn_started') }, 0);
    m.send({ kind: 'event', event: ev('turn_ended', 'completed') }, 320);
    const late = m.send({ kind: 'show_timer' }, 500);

    expect(late.ignored).toBe(true);
    expect(m.state).toBe('ended');
    expect(m.wantsOverlay).toBe(false);
  });

  it.each(['completed', 'aborted', 'error'] as const)('records outcome %s', (outcome) => {
    const m = machine();
    m.send({ kind: 'event', event: ev('turn_started') }, 0);
    m.send({ kind: 'show_timer' }, 500);
    m.send({ kind: 'event', event: ev('turn_ended', outcome) }, 900);
    expect(m.outcome).toBe(outcome);
    expect(m.state).toBe('ended');
  });

  it('cancel hides the overlay and marks the turn aborted', () => {
    const m = machine();
    m.send({ kind: 'event', event: ev('turn_started') }, 0);
    m.send({ kind: 'show_timer' }, 500);
    const t = m.send({ kind: 'cancel', outcome: 'aborted' }, 700);

    expect(m.state).toBe('ended');
    expect(m.outcome).toBe('aborted');
    expect(types(t.effects)).toContain('hide_overlay');
  });

  it('cancel on a turn that was never shown does not emit hide_overlay', () => {
    const m = machine();
    m.send({ kind: 'event', event: ev('turn_started') }, 0);
    const t = m.send({ kind: 'cancel', outcome: 'ide_closed' }, 100);
    expect(types(t.effects)).not.toContain('hide_overlay');
    expect(m.outcome).toBe('ide_closed');
  });

  it('the watchdog ends a turn the adapter never closed', () => {
    const m = machine({ watchdogMs: 1000 });
    m.send({ kind: 'event', event: ev('turn_started') }, 0);
    m.send({ kind: 'show_timer' }, 500);
    const t = m.send({ kind: 'watchdog' }, 1000);

    expect(m.state).toBe('ended');
    expect(m.outcome).toBe('timeout');
    expect(types(t.effects)).toContain('hide_overlay');
  });

  it('ended is absorbing: duplicate ends are ignored and keep the first outcome', () => {
    const m = machine();
    m.send({ kind: 'event', event: ev('turn_started') }, 0);
    m.send({ kind: 'show_timer' }, 500);
    m.send({ kind: 'event', event: ev('turn_ended', 'aborted') }, 600);
    const dup = m.send({ kind: 'event', event: ev('turn_ended', 'completed') }, 700);

    expect(dup.ignored).toBe(true);
    expect(m.outcome).toBe('aborted');
  });

  it('a repeated turn_started for the same turn is ignored, not re-armed', () => {
    const m = machine();
    m.send({ kind: 'event', event: ev('turn_started') }, 0);
    const again = m.send({ kind: 'event', event: ev('turn_started') }, 10);
    expect(again.ignored).toBe(true);
    expect(m.state).toBe('waiting');
  });

  it('a turn_ended for a turn we never saw start goes straight to ended', () => {
    const m = machine();
    const t = m.send({ kind: 'event', event: ev('turn_ended', 'completed') }, 0);
    expect(t.state).toBe('ended');
    expect(types(t.effects)).toEqual([]);
    expect(m.wantsOverlay).toBe(false);
  });

  describe('hide mode', () => {
    it('first-response ends the turn on the first output', () => {
      const m = machine({ hideMode: 'first-response' });
      m.send({ kind: 'event', event: ev('turn_started') }, 0);
      m.send({ kind: 'show_timer' }, 500);
      const t = m.send({ kind: 'event', event: ev('turn_progress') }, 800);

      expect(m.state).toBe('ended');
      expect(types(t.effects)).toContain('hide_overlay');
    });

    it('full-completion keeps the overlay up through progress', () => {
      const m = machine({ hideMode: 'full-completion' });
      m.send({ kind: 'event', event: ev('turn_started') }, 0);
      m.send({ kind: 'show_timer' }, 500);
      const t = m.send({ kind: 'event', event: ev('turn_progress') }, 800);

      expect(t.ignored).toBe(true);
      expect(m.state).toBe('active');
      expect(m.wantsOverlay).toBe(true);
    });
  });

  it('honours a custom show delay', () => {
    const m = machine({ showDelayMs: 1500 });
    const t = m.send({ kind: 'event', event: ev('turn_started') }, 0);
    expect(t.effects[0]).toMatchObject({ type: 'arm_show_timer', delayMs: 1500 });
  });
});
