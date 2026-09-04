/**
 * The one line the menu bar shows about a source.
 *
 * A pure function for the same reason `formatFeedLine` is one — the tray has no
 * test harness — but it earns its place for a second reason: a source that has
 * never sent an event is indistinguishable, from the outside, from a source
 * that is working perfectly and simply idle. The whole product is one mechanic
 * (video while the agent thinks), so a silently-unwired adapter reads to the
 * user as "the app is broken" rather than "this tool is not connected". That
 * has to be said out loud in the only surface the user has.
 */

import type { SourceInfo } from '../core/sourceRegistry.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Long enough that a normal working day of silence is not called out. */
const STALE_MS = 7 * DAY_MS;

function describeAge(at: number, now: number): string {
  const age = Math.max(0, now - at);
  if (age < MINUTE_MS) return 'just now';
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)}m ago`;
  if (age < DAY_MS) return `${Math.floor(age / HOUR_MS)}h ago`;
  return `${Math.floor(age / DAY_MS)}d ago`;
}

export function formatSourceLine(
  info: SourceInfo,
  label: string,
  now: number,
): string {
  const name = label + (info.confidence === 'heuristic' ? ' (guess)' : '');

  // Never seen: the adapter is not installed, or it is installed and the tool
  // it hooks has not been used. Either way the honest answer is the same.
  if (info.events === 0) return `${name} — no events yet`;

  // Seen, but every one of them was thrown away. Without this the checkbox
  // being off looks like a preference rather than the reason nothing happens.
  if (info.droppedWhileDisabled === info.events) {
    return `${name} — ${info.events} event(s) ignored, switched off`;
  }

  const age = describeAge(info.lastSeenAt, now);
  if (now - info.lastSeenAt >= STALE_MS) return `${name} — last seen ${age}`;
  return `${name} — active ${age}`;
}
