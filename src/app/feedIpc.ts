/** Runtime-checked IPC boundary for the catalog renderer. */

import type { Category, LocalFeedback } from '../youtube/catalog.js';

export const FEED_CHANNELS = {
  close: 'feed:close',
  next: 'feed:next',
  previous: 'feed:previous',
  peek: 'feed:peek',
  refresh: 'feed:refresh',
  status: 'feed:status',
  feedback: 'feed:feedback',
  playbackError: 'feed:playback-error',
  muted: 'feed:muted',
} as const;

const CATEGORIES = ['humor', 'gaming', 'animals', 'technology', 'music_art', 'other'] as const;
const VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Rebuild field by field so renderer data cannot add persistence fields. */
export function parseFeedback(value: unknown): LocalFeedback | null {
  const input = record(value);
  if (!input || typeof input.videoId !== 'string' || !VIDEO_ID.test(input.videoId)) return null;
  if (!CATEGORIES.includes(input.category as Category)) return null;

  const impressions = count(input.impressions);
  const completedViews = count(input.completedViews);
  const quickSkips = count(input.quickSkips);
  if (impressions === null || completedViews === null || quickSkips === null) return null;

  const feedback: LocalFeedback = {
    videoId: input.videoId,
    category: input.category as Category,
    impressions,
    completedViews,
    quickSkips,
  };
  if (typeof input.liked === 'boolean') feedback.liked = input.liked;
  if (typeof input.hidden === 'boolean') feedback.hidden = input.hidden;
  if (typeof input.lastViewedAt === 'string' && input.lastViewedAt.length <= 64) {
    feedback.lastViewedAt = input.lastViewedAt;
  }
  return feedback;
}

/** Playback details are intentionally not retained or logged. */
export function parseBrokenVideoId(value: unknown): string | null {
  const input = record(value);
  return input && typeof input.videoId === 'string' && VIDEO_ID.test(input.videoId)
    ? input.videoId
    : null;
}
