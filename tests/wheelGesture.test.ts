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
    expect(r.endIfQuiet(250)).toBe(true);
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
});
