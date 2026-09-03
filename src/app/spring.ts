/**
 * Damped-spring integration and drag physics.
 *
 * Pure and frame-rate independent: every function takes the real elapsed time,
 * so a dropped frame changes nothing about where the motion ends up. Nothing
 * here knows about Electron, the DOM, or a window.
 */

export interface SpringConfig {
  mass: number;
  stiffness: number;
  damping: number;
}

export interface SpringState {
  value: number;
  velocity: number;
}

/** Morphing between the two window shapes: quick, settles softly. */
export const MORPH_SPRING: SpringConfig = { mass: 1, stiffness: 350, damping: 32 };

/** Flying to an anchor after a drag: a little stiffer, so it feels magnetic. */
export const SNAP_SPRING: SpringConfig = { mass: 1, stiffness: 460, damping: 38 };

/**
 * When a motion is over — and it depends on what is being animated.
 *
 * A spring driving pixels can stop a twentieth of a pixel short; one driving a
 * 0…1 morph progress cannot, because 0.05 there is 5% of a 326px surface, and
 * stopping that early would put a 16px jump at the end of every collapse.
 */
export interface RestThresholds {
  velocity: number;
  distance: number;
}

/** Half a pixel and 5 px/s: below both, the motion is over. */
export const REST_PIXELS: RestThresholds = { velocity: 5, distance: 0.5 };
export const REST_PROGRESS: RestThresholds = { velocity: 0.01, distance: 0.001 };

/**
 * A stiff spring integrated at 60 Hz can overshoot into instability, so the
 * step is subdivided. 1/240 s is small enough for every preset here.
 */
const MAX_SUBSTEP = 1 / 240;
/**
 * A long frame must not be simulated in full: 32 ms caps how far one step can
 * carry, so a hitch slows the motion for a frame instead of teleporting it.
 */
const MAX_DT = 0.032;

export function stepSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dtSeconds: number,
): SpringState {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return state;

  let remaining = Math.min(dtSeconds, MAX_DT);
  let { value, velocity } = state;
  const { mass, stiffness, damping } = config;

  while (remaining > 0) {
    const dt = Math.min(remaining, MAX_SUBSTEP);
    remaining -= dt;
    // F = −k·x − c·v, integrated semi-implicitly so energy does not creep up.
    const force = -stiffness * (value - target) - damping * velocity;
    velocity += (force / mass) * dt;
    value += velocity * dt;
  }
  return { value, velocity };
}

export function isAtRest(
  state: SpringState,
  target: number,
  thresholds: RestThresholds = REST_PIXELS,
): boolean {
  return (
    Math.abs(state.velocity) < thresholds.velocity &&
    Math.abs(target - state.value) < thresholds.distance
  );
}

// ── drag physics ───────────────────────────────────────────────────────────

export interface DragSample {
  x: number;
  y: number;
  timestamp: number;
}

export interface Velocity {
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Samples older than this say nothing about how fast the hand is moving now. */
const VELOCITY_WINDOW_MS = 100;
/** Faster than this is noise from a warped cursor, not a human wrist. */
const MAX_VELOCITY = 6000;

/**
 * Velocity in px/second, measured across the last ~100 ms.
 *
 * The window matters: using the whole gesture would report the average speed of
 * a drag that has already stopped, and a release after a pause would still fly.
 */
export function calculateDragVelocity(samples: readonly DragSample[]): Velocity {
  if (samples.length < 2) return { x: 0, y: 0 };

  const last = samples[samples.length - 1]!;
  let first = samples[0]!;
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    first = samples[i]!;
    if (last.timestamp - first.timestamp >= VELOCITY_WINDOW_MS) break;
  }

  const dt = (last.timestamp - first.timestamp) / 1000;
  if (dt <= 0) return { x: 0, y: 0 };

  const clamp = (v: number) => Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, v));
  return { x: clamp((last.x - first.x) / dt), y: clamp((last.y - first.y) / dt) };
}

/**
 * Where the window would be a moment from now if the hand kept going.
 *
 * Choosing the anchor from this point rather than the release point is what
 * makes a flick land where it was thrown, the way a PiP window does.
 */
export function projectPosition(
  position: Point,
  velocity: Velocity,
  projectionMs: number,
): Point {
  const seconds = projectionMs / 1000;
  return {
    x: position.x + velocity.x * seconds,
    y: position.y + velocity.y * seconds,
  };
}

/** How far ahead to look. Scales with speed, so a slow drag barely projects. */
export function projectionWindowMs(velocity: Velocity, min = 100, max = 160): number {
  const speed = Math.hypot(velocity.x, velocity.y);
  const t = Math.min(1, speed / 2000);
  return min + (max - min) * t;
}
