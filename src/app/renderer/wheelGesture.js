// Small, stateful recognizer for vertical wheel gestures.  It deliberately
// knows nothing about playback or the DOM so the renderer and tests share the
// same momentum handling.
const WHEEL_THRESHOLD = 120;
const WHEEL_QUIET_PERIOD_MS = 180;
const WHEEL_DIRECTION_RATIO = 1.15;

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
    // null, not 0: a wheel event can legitimately arrive at timestamp 0, and a
    // zero sentinel would make endIfQuiet() never fire for that gesture.
    this.lastEventAt = null;
  }

  reset() {
    this.state = 'idle';
    this.accumulated = 0;
    this.direction = 0;
    this.lastEventAt = null;
  }

  endIfQuiet(now) {
    if (this.state !== 'idle' && this.lastEventAt !== null && now - this.lastEventAt >= this.quietPeriodMs) {
      this.reset();
      return true;
    }
    return false;
  }

  handle(event, now) {
    const { x, y } = normalizeWheelDelta(event, event.viewportHeight || 800);
    this.endIfQuiet(now);
    this.lastEventAt = now;
    if (Math.abs(x) > Math.abs(y) * this.directionRatio || y === 0) return { type: 'ignored', reason: 'horizontal' };

    const sign = Math.sign(y);
    if (this.state === 'locked') return { type: 'momentum', direction: this.direction };
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
    return { type: 'commit', direction: sign > 0 ? 'next' : 'previous' };
  }
}

const api = { WHEEL_THRESHOLD, WHEEL_QUIET_PERIOD_MS, WHEEL_DIRECTION_RATIO, normalizeWheelDelta, WheelGestureRecognizer };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else globalThis.WheelGesture = api;
