import type { Timers } from '../src/core/turnRegistry.js';

interface Scheduled {
  id: number;
  at: number;
  fn: () => void;
}

/** Deterministic clock: nothing fires until the test advances time. */
export class FakeTimers implements Timers {
  private t = 0;
  private seq = 1;
  private queue: Scheduled[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const s: Scheduled = { id: this.seq++, at: this.t + ms, fn };
    this.queue.push(s);
    return s.id;
  }

  clearTimeout(handle: unknown): void {
    this.queue = this.queue.filter((s) => s.id !== handle);
  }

  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.queue
        .filter((s) => s.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.queue = this.queue.filter((s) => s.id !== due.id);
      this.t = due.at;
      due.fn();
    }
    this.t = target;
  }

  get pending(): number {
    return this.queue.length;
  }
}
