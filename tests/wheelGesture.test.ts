import { describe, expect, it } from 'vitest';
import { WheelGestureRecognizer, normalizeWheelDelta } from '../src/app/renderer/wheelGesture.js';

const event = (deltaY: number, deltaX = 0, deltaMode = 0) => ({ deltaY, deltaX, deltaMode });

describe('wheel gesture recognizer', () => {
  it('ignores weak and mostly horizontal movement', () => {
    const r = new WheelGestureRecognizer();
    expect(r.handle(event(20), 0).type).toBe('tracking');
    expect(r.handle(event(100, 140), 10).type).toBe('ignored');
  });

  it('commits once and ignores momentum until quiet', () => {
    const r = new WheelGestureRecognizer();
    expect(r.handle(event(70), 0).type).toBe('tracking');
    expect(r.handle(event(60), 8).type).toBe('commit');
    expect(r.handle(event(240), 30).type).toBe('momentum');
    expect(r.handle(event(240), 80).type).toBe('momentum');
    expect(r.endIfQuiet(270)).toBe(true);
  });

  it('accepts a new gesture after the quiet period', () => {
    const r = new WheelGestureRecognizer();
    expect(r.handle(event(130), 0).type).toBe('commit');
    expect(r.handle(event(130), 300).type).toBe('commit');
  });

  it('resets intent when direction changes', () => {
    const r = new WheelGestureRecognizer({ threshold: 100 });
    expect(r.handle(event(70), 0).type).toBe('tracking');
    expect(r.handle(event(-70), 20).type).toBe('tracking');
    expect(r.handle(event(-40), 40).type).toBe('commit');
  });

  it('normalizes line and page delta modes', () => {
    expect(normalizeWheelDelta(event(2, 1, 1))).toEqual({ x: 16, y: 32 });
    expect(normalizeWheelDelta(event(1, 0, 2), 600)).toEqual({ x: 0, y: 600 });
  });

  it('keeps a committed gesture locked while transition is active', () => {
    const r = new WheelGestureRecognizer({ quietPeriodMs: 50 });
    expect(r.handle(event(130), 0).type).toBe('commit');
    // A transition longer than quiet period must not let its momentum tail
    // become a second commit.
    expect(r.handle(event(80), 100, { holdLock: true }).type).toBe('momentum');
    expect(r.handle(event(80), 220, { holdLock: true }).type).toBe('momentum');
    expect(r.endIfQuiet(280)).toBe(true);
    expect(r.handle(event(130), 300).type).toBe('commit');
  });

  it('does not end a locked stream while transition remains active', () => {
    const r = new WheelGestureRecognizer({ quietPeriodMs: 40 });
    r.handle(event(130), 0);
    expect(r.endIfQuiet(100, { holdLock: true })).toBe(false);
    expect(r.state).toBe('locked');
  });

  it('controller pattern commits once across a long transition, then commits again', () => {
    const r = new WheelGestureRecognizer({ quietPeriodMs: 50 });
    let commits = 0;
    const dispatch = (deltaY: number, now: number, transitioning: boolean) => {
      const result = r.handle(event(deltaY), now, { holdLock: transitioning });
      if (result.type === 'commit' && !transitioning) commits++;
    };
    dispatch(70, 0, false); dispatch(70, 10, false);
    dispatch(120, 120, true); dispatch(100, 220, true); dispatch(80, 320, true);
    expect(commits).toBe(1);
    expect(r.endIfQuiet(500)).toBe(true);
    dispatch(130, 600, false);
    expect(commits).toBe(2);
  });

  it('does not re-arm on a continuously decaying momentum tail', () => {
    const r = new WheelGestureRecognizer();
    expect(r.handle(event(130), 0).type).toBe('commit');
    for (const [i, delta] of [70, 55, 42, 31, 22, 16, 11, 8, 5].entries()) {
      expect(r.handle(event(delta), 20 + i * 40, { holdLock: i < 7 }).type).not.toBe('commit');
    }
  });

  it('recognizes a fresh same-direction impulse before quiet timeout', () => {
    const r = new WheelGestureRecognizer();
    expect(r.handle(event(130), 0).type).toBe('commit');
    r.handle(event(12), 40, { holdLock: true });
    r.handle(event(8), 80, { holdLock: true });
    // 80ms is the smallest boundary above the 66.8ms maximum gap observed
    // in the physical momentum captures; it is a new impulse, not a tail.
    expect(r.handle(event(45), 160).type).toBe('tracking');
    expect(r.handle(event(75), 180).type).toBe('commit');
  });

  it('does not re-arm from a same-direction growth inside one physical stream', () => {
    const r = new WheelGestureRecognizer();
    expect(r.handle(event(130), 0).type).toBe('commit');
    r.handle(event(15), 50);
    // This is the measured false sequence: 15 → 41 after 22.3ms.
    expect(r.handle(event(41), 72.3).type).toBe('momentum');
    expect(r.state).toBe('locked');
  });

  it('ignores a small reverse bounce but commits a full reverse gesture', () => {
    const r = new WheelGestureRecognizer();
    expect(r.handle(event(130), 0).type).toBe('commit');
    r.handle(event(10), 30, { holdLock: true });
    expect(r.handle(event(-12), 80).type).toBe('momentum');
    expect(r.handle(event(-60), 120).type).toBe('tracking');
    expect(r.handle(event(-65), 140).type).toBe('commit');
  });
});
