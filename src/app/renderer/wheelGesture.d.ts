export const WHEEL_THRESHOLD: number;
export const WHEEL_QUIET_PERIOD_MS: number;
export const WHEEL_DIRECTION_RATIO: number;
export function normalizeWheelDelta(event: { deltaX: number; deltaY: number; deltaMode: number }, viewportHeight?: number): { x: number; y: number };
export class WheelGestureRecognizer {
  constructor(options?: { threshold?: number; quietPeriodMs?: number; directionRatio?: number });
  state: 'idle' | 'tracking' | 'locked';
  accumulated: number;
  direction: number;
  lastEventAt: number;
  endIfQuiet(now: number): boolean;
  reset(): void;
  handle(event: { deltaX: number; deltaY: number; deltaMode: number; viewportHeight?: number }, now: number): { type: string; direction?: string | number; reason?: string; accumulated?: number };
}
