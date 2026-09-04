// Small, stateful recognizer for vertical wheel gestures.  It deliberately
// knows nothing about playback or the DOM so the renderer and tests share the
// same momentum handling.
const WHEEL_THRESHOLD = 120;
const WHEEL_QUIET_PERIOD_MS = 180;
const WHEEL_DIRECTION_RATIO = 1.15;
const FRESH_IMPULSE_MIN = 24;
const FRESH_IMPULSE_GROWTH = 1.45;
// Physical captures showed momentum gaps up to 66.8ms in both a normal and
// a strong flick. A same-direction rise without at least this 70ms boundary
// is still one continuous impulse, even if its magnitude briefly increases.
const FRESH_IMPULSE_MIN_GAP_MS = 70;

function normalizeWheelDelta(event, viewportHeight = 800) {
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1;
  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

class WheelGestureRecognizer {
  constructor({ threshold = WHEEL_THRESHOLD, quietPeriodMs = WHEEL_QUIET_PERIOD_MS, directionRatio = WHEEL_DIRECTION_RATIO } = {}) {
    this.threshold = threshold;
    this.quietPeriodMs = quietPeriodMs;
    this.directionRatio = directionRatio;
    this.state = 'idle';
    this.accumulated = 0;
    this.direction = 0;
    this.lastEventAt = 0;
    this.peakMagnitude = 0;
    this.lastMagnitude = 0;
    this.lastGapMs = 0;
    this.weakened = false;
  }

  reset() {
    this.state = 'idle';
    this.accumulated = 0;
    this.direction = 0;
    this.lastEventAt = 0;
    this.peakMagnitude = 0;
    this.lastMagnitude = 0;
    this.lastGapMs = 0;
    this.weakened = false;
  }

  endIfQuiet(now, { holdLock = false } = {}) {
    if (holdLock && this.state === 'locked') return false;
    if (this.state !== 'idle' && this.lastEventAt >= 0 && now - this.lastEventAt >= this.quietPeriodMs) {
      this.reset();
      return true;
    }
    return false;
  }

  handle(event, now, { holdLock = false } = {}) {
    const { x, y } = normalizeWheelDelta(event, event.viewportHeight || 800);
    const previousEventAt = this.lastEventAt;
    const gapMs = previousEventAt > 0 ? now - previousEventAt : 0;
    this.endIfQuiet(now, { holdLock });
    this.lastEventAt = now;
    this.lastGapMs = gapMs;
    if (Math.abs(x) > Math.abs(y) * this.directionRatio || y === 0) return { type: 'ignored', reason: 'horizontal' };

    const sign = Math.sign(y);
    const magnitude = Math.abs(y);
    if (this.state === 'locked') {
      if (holdLock) {
        this.peakMagnitude = Math.max(this.peakMagnitude, magnitude);
        this.lastMagnitude = magnitude;
        return { type: 'momentum', direction: this.direction };
      }
      if (sign === this.direction) {
        if (magnitude < FRESH_IMPULSE_MIN || magnitude < this.lastMagnitude * 0.75 || magnitude < this.peakMagnitude * 0.65) this.weakened = true;
        if (this.weakened && gapMs >= FRESH_IMPULSE_MIN_GAP_MS && magnitude >= FRESH_IMPULSE_MIN && magnitude > this.lastMagnitude * FRESH_IMPULSE_GROWTH) {
          this.state = 'tracking'; this.accumulated = y; this.direction = sign; this.lastMagnitude = magnitude;
          return { type: 'tracking', accumulated: this.accumulated, fresh: true };
        }
        this.lastMagnitude = magnitude;
        return { type: 'momentum', direction: this.direction };
      }
      if (magnitude < FRESH_IMPULSE_MIN) return { type: 'momentum', direction: this.direction };
      this.state = 'tracking'; this.accumulated = y; this.direction = sign; this.lastMagnitude = magnitude;
      return Math.abs(this.accumulated) >= this.threshold
        ? (this.state = 'locked', { type: 'commit', direction: sign > 0 ? 'next' : 'previous' })
        : { type: 'tracking', accumulated: this.accumulated, fresh: true };
    }
    if (this.direction && sign !== this.direction) {
      this.accumulated = 0;
      this.state = 'tracking';
    }
    if (this.state === 'idle') this.state = 'tracking';
    this.direction = sign;
    this.accumulated += y;
    if (Math.abs(this.accumulated) < this.threshold) return { type: 'tracking', accumulated: this.accumulated };

    this.state = 'locked';
    this.accumulated = 0;
    this.peakMagnitude = magnitude;
    this.lastMagnitude = magnitude;
    this.weakened = false;
    return { type: 'commit', direction: sign > 0 ? 'next' : 'previous' };
  }
}

const api = { WHEEL_THRESHOLD, WHEEL_QUIET_PERIOD_MS, WHEEL_DIRECTION_RATIO, FRESH_IMPULSE_MIN, FRESH_IMPULSE_GROWTH, FRESH_IMPULSE_MIN_GAP_MS, normalizeWheelDelta, WheelGestureRecognizer };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else globalThis.WheelGesture = api;
