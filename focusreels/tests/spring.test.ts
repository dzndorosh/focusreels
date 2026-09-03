import { describe, expect, it } from 'vitest';
import {
  MORPH_SPRING,
  REST_PROGRESS,
  SNAP_SPRING,
  calculateDragVelocity,
  isAtRest,
  projectPosition,
  projectionWindowMs,
  stepSpring,
  type SpringState,
} from '../src/app/spring.js';

/** Run a spring to rest, reporting the path it took. */
function settle(config = MORPH_SPRING, target = 1, dt = 1 / 60, maxFrames = 600) {
  let state: SpringState = { value: 0, velocity: 0 };
  const path: number[] = [];
  let frames = 0;
  while (frames < maxFrames && !isAtRest(state, target, REST_PROGRESS)) {
    state = stepSpring(state, target, config, dt);
    path.push(state.value);
    frames += 1;
  }
  return { state, path, frames, seconds: frames * dt };
}

describe('stepSpring', () => {
  it('settles on the target instead of orbiting it', () => {
    const { state, frames } = settle();
    expect(frames).toBeLessThan(600);
    expect(state.value).toBeCloseTo(1, 1);
    expect(Math.abs(state.velocity)).toBeLessThan(0.05);
  });

  it('starts fast and eases out — the opposite of a linear tween', () => {
    const { path } = settle();
    const firstTenth = path[Math.floor(path.length * 0.1)]!;
    const halfway = path[Math.floor(path.length * 0.5)]!;
    // Ten percent of the way through the motion, far more than ten percent done.
    expect(firstTenth).toBeGreaterThan(0.1);
    expect(halfway).toBeGreaterThan(0.9);
  });

  it('overshoots a little, but never bounces visibly', () => {
    const { path } = settle();
    const peak = Math.max(...path);
    expect(peak).toBeGreaterThan(1); // some overshoot is what makes it feel alive
    expect(peak).toBeLessThan(1.02); // ~2% — a few px on a 326px surface
  });

  it('runs on the clock, not the frame count — 60 Hz and ProMotion agree', () => {
    const promotion = settle(MORPH_SPRING, 1, 1 / 120);
    const sixty = settle(MORPH_SPRING, 1, 1 / 60);
    expect(promotion.state.value).toBeCloseTo(sixty.state.value, 2);
    expect(Math.abs(promotion.seconds - sixty.seconds)).toBeLessThan(0.05);
    // twice the frames for the same motion
    expect(promotion.frames).toBeGreaterThan(sixty.frames * 1.5);
  });

  it('a hitch slows the motion rather than teleporting it', () => {
    // The 32 ms cap is deliberate: below 31 fps a step simulates less than the
    // frame took, so a stutter stretches the animation instead of jumping it.
    const janky = settle(MORPH_SPRING, 1, 1 / 15);
    expect(janky.state.value).toBeCloseTo(1, 1);
    expect(Math.max(...janky.path)).toBeLessThan(1.05); // and never overshoots wildly
  });

  it('survives a frame drop without exploding', () => {
    let state: SpringState = { value: 0, velocity: 0 };
    state = stepSpring(state, 1, SNAP_SPRING, 2); // a two-second stall
    expect(Number.isFinite(state.value)).toBe(true);
    expect(Math.abs(state.value)).toBeLessThan(2);
  });

  it('ignores a zero or nonsense timestep', () => {
    const state = { value: 0.3, velocity: 5 };
    expect(stepSpring(state, 1, MORPH_SPRING, 0)).toBe(state);
    expect(stepSpring(state, 1, MORPH_SPRING, Number.NaN)).toBe(state);
  });

  it('takes over an in-flight motion, keeping its speed', () => {
    // Halfway to 1, then the target flips back to 0 — as when Expand is pressed
    // during a Collapse. Momentum has to carry through the reversal.
    let state: SpringState = { value: 0, velocity: 0 };
    for (let i = 0; i < 8; i += 1) state = stepSpring(state, 1, MORPH_SPRING, 1 / 60);
    expect(state.velocity).toBeGreaterThan(0);

    const reversed = stepSpring(state, 0, MORPH_SPRING, 1 / 60);
    expect(reversed.velocity).toBeLessThan(state.velocity); // decelerating, not jumping
    expect(reversed.value).toBeGreaterThan(0); // no snap back to the start
  });

  it('the snap preset settles sooner than the morph preset', () => {
    expect(settle(SNAP_SPRING).frames).toBeLessThan(settle(MORPH_SPRING).frames);
  });

  it('both presets settle in the 350–500 ms range the design asks for', () => {
    for (const config of [MORPH_SPRING, SNAP_SPRING]) {
      const { seconds } = settle(config);
      expect(seconds).toBeGreaterThan(0.34);
      expect(seconds).toBeLessThan(0.55);
    }
  });

  it('stops close enough that the final sync is invisible', () => {
    // The threshold is what decides whether a collapse ends with a jump.
    const { state } = settle();
    expect(Math.abs(1 - state.value)).toBeLessThan(0.002); // < 1px on 326px
  });
});

describe('calculateDragVelocity', () => {
  it('measures px per second', () => {
    const v = calculateDragVelocity([
      { x: 0, y: 0, timestamp: 0 },
      { x: 100, y: 50, timestamp: 100 },
    ]);
    expect(v.x).toBeCloseTo(1000, 0);
    expect(v.y).toBeCloseTo(500, 0);
  });

  it('reports a standstill after the hand stops, however fast it was', () => {
    const samples = [
      { x: 0, y: 0, timestamp: 0 },
      { x: 400, y: 0, timestamp: 100 }, // a fast flick…
      { x: 402, y: 0, timestamp: 300 }, // …then held still
      { x: 402, y: 0, timestamp: 400 },
    ];
    expect(Math.abs(calculateDragVelocity(samples).x)).toBeLessThan(30);
  });

  it('needs two samples, and survives duplicate timestamps', () => {
    expect(calculateDragVelocity([])).toEqual({ x: 0, y: 0 });
    expect(calculateDragVelocity([{ x: 1, y: 1, timestamp: 5 }])).toEqual({ x: 0, y: 0 });
    expect(
      calculateDragVelocity([
        { x: 0, y: 0, timestamp: 7 },
        { x: 9, y: 9, timestamp: 7 },
      ]),
    ).toEqual({ x: 0, y: 0 });
  });

  it('clamps an impossible speed from a warped cursor', () => {
    const v = calculateDragVelocity([
      { x: 0, y: 0, timestamp: 0 },
      { x: 100000, y: 0, timestamp: 1 },
    ]);
    expect(v.x).toBeLessThanOrEqual(6000);
  });
});

describe('projectPosition', () => {
  it('throws the window ahead along the release velocity', () => {
    const p = projectPosition({ x: 100, y: 100 }, { x: 1000, y: -500 }, 120);
    expect(p.x).toBeCloseTo(220, 0);
    expect(p.y).toBeCloseTo(40, 0);
  });

  it('barely moves the target when the drag was slow', () => {
    const p = projectPosition({ x: 100, y: 100 }, { x: 30, y: 0 }, 120);
    expect(p.x - 100).toBeLessThan(5);
  });

  it('looks further ahead the harder you throw', () => {
    expect(projectionWindowMs({ x: 0, y: 0 })).toBe(100);
    expect(projectionWindowMs({ x: 3000, y: 0 })).toBe(160);
    const gentle = projectionWindowMs({ x: 500, y: 0 });
    expect(gentle).toBeGreaterThan(100);
    expect(gentle).toBeLessThan(160);
  });
});
