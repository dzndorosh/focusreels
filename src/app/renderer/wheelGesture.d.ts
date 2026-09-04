export const WHEEL_THRESHOLD: number;
export const WHEEL_QUIET_PERIOD_MS: number;
export const WHEEL_DIRECTION_RATIO: number;
export const FRESH_IMPULSE_MIN: number;
export const FRESH_IMPULSE_GROWTH: number;
export const FRESH_IMPULSE_MIN_GAP_MS: number;
export function normalizeWheelDelta(event: { deltaX: number; deltaY: number; deltaMode: number }, viewportHeight?: number): { x: number; y: number };
export class WheelGestureRecognizer {
  constructor(options?: { threshold?: number; quietPeriodMs?: number; directionRatio?: number });
  state: 'idle' | 'tracking' | 'locked';
  accumulated: number;
  direction: number;
  lastEventAt: number;
  peakMagnitude: number;
  lastMagnitude: number;
  lastGapMs: number;
  weakened: boolean;
  endIfQuiet(now: number, options?: { holdLock?: boolean }): boolean;
  reset(): void;
  handle(event: { deltaX: number; deltaY: number; deltaMode: number; viewportHeight?: number }, now: number, options?: { holdLock?: boolean }): { type: string; direction?: string | number; reason?: string; accumulated?: number; fresh?: boolean };
}
