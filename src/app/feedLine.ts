/**
 * The one line the menu bar shows about the feed.
 *
 * A pure function rather than an expression inside the tray, because this is
 * the only part of the menu with logic worth testing — the tray itself has no
 * test harness in this repo.
 */

import type { FeedStatus } from '../youtube/types.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function describeAge(generatedAt: string | undefined, now: number): string | null {
  if (!generatedAt) return null;
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) return null;

  // A machine whose clock trails the build server would otherwise read "-3h ago".
  const age = Math.max(0, now - at);
  if (age < HOUR_MS) return 'published just now';
  if (age < 2 * DAY_MS) return `published ${Math.floor(age / HOUR_MS)}h ago`;
  return `published ${Math.floor(age / DAY_MS)}d ago`;
}

export function formatFeedLine(status: FeedStatus, now: number): string {
  if (status.demoMode) {
    return `Demo mode${status.reason ? ` · ${status.reason}` : ''}`;
  }

  const total = status.totalVideos ?? status.queued;
  const counts = `Feed: ${status.queued} of ${total}`;

  // Only a remote catalog has an age worth stating: a bundled one ages with the
  // release, and saying "published 40d ago" about it would read as a fault.
  if (status.catalogSource !== 'remote') return `${counts} · bundled snapshot`;

  const age = describeAge(status.generatedAt, now);
  return age ? `${counts} · ${age}` : counts;
}
