import { readFileSync } from 'node:fs';

export const CATEGORIES = ['humor', 'gaming', 'animals', 'technology', 'music_art', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface YouTubeShortItem {
  id: string;
  videoId: string;
  category: Category;
  weight: number;
  enabled: boolean;
  addedAt: string;
}

export interface YouTubeShortsCatalog {
  schemaVersion: 1;
  generatedAt: string;
  videos: YouTubeShortItem[];
}

export interface LocalFeedback {
  videoId: string;
  category: Category;
  liked?: boolean;
  hidden?: boolean;
  impressions: number;
  completedViews: number;
  quickSkips: number;
  lastViewedAt?: string;
}

export const EMPTY_CATALOG: YouTubeShortsCatalog = {
  schemaVersion: 1,
  generatedAt: '1970-01-01T00:00:00.000Z',
  videos: [],
};

const VIDEO_ID = /^[\w-]{6,}$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

function parseItem(value: unknown): YouTubeShortItem | null {
  const input = record(value);
  if (
    !input ||
    typeof input.id !== 'string' ||
    typeof input.videoId !== 'string' ||
    !VIDEO_ID.test(input.videoId) ||
    !isCategory(input.category) ||
    typeof input.weight !== 'number' ||
    !Number.isFinite(input.weight) ||
    typeof input.enabled !== 'boolean' ||
    typeof input.addedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: input.id,
    videoId: input.videoId,
    category: input.category,
    weight: input.weight,
    enabled: input.enabled,
    addedAt: input.addedAt,
  };
}

/** Validates untrusted JSON and returns only enabled, de-duplicated items. */
export function validateCatalog(value: unknown): YouTubeShortsCatalog | null {
  const input = record(value);
  if (
    !input ||
    input.schemaVersion !== 1 ||
    typeof input.generatedAt !== 'string' ||
    !Array.isArray(input.videos)
  ) {
    return null;
  }

  const seen = new Set<string>();
  const videos: YouTubeShortItem[] = [];
  for (const rawItem of input.videos) {
    const item = parseItem(rawItem);
    if (!item || !item.enabled || seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    videos.push(item);
  }
  return videos.length > 0 ? { schemaVersion: 1, generatedAt: input.generatedAt, videos } : null;
}

export function loadCatalog(options: { fallback: YouTubeShortsCatalog; cacheFile: string }): YouTubeShortsCatalog {
  try {
    const cached = validateCatalog(JSON.parse(readFileSync(options.cacheFile, 'utf8')));
    return cached ?? validateCatalog(options.fallback) ?? options.fallback;
  } catch {
    return validateCatalog(options.fallback) ?? options.fallback;
  }
}

export async function fetchRemoteCatalog(
  url: string,
  timeoutMs = 4_000,
  etag?: string,
): Promise<{ catalog: YouTubeShortsCatalog | null; etag?: string; notModified?: boolean }> {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') return { catalog: null };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(parsedUrl, {
        signal: controller.signal,
        redirect: 'error',
        headers: etag ? { 'If-None-Match': etag } : {},
      });
      if (response.status === 304) return { catalog: null, notModified: true, etag };
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 2_000_000) {
        return { catalog: null };
      }
      return {
        catalog: validateCatalog(await response.json()),
        etag: response.headers.get('etag') ?? undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { catalog: null };
  }
}

/** Pure ranking; persistence and the decision to start a new lap stay outside. */
export function rankCatalog(
  items: readonly YouTubeShortItem[],
  feedback: readonly LocalFeedback[],
  seen: ReadonlySet<string>,
  rng: () => number = Math.random,
): YouTubeShortItem[] {
  const feedbackByVideo = new Map(feedback.map((item) => [item.videoId, item]));
  return items
    .filter((item) => item.enabled && !seen.has(item.videoId) && !feedbackByVideo.get(item.videoId)?.hidden)
    .map((item) => {
      const itemFeedback = feedbackByVideo.get(item.videoId);
      const completionBonus =
        itemFeedback && itemFeedback.completedViews > itemFeedback.impressions * 0.6 ? 0.08 : 0;
      const bonus = Math.min(0.25, (itemFeedback?.liked ? 0.15 : 0) + completionBonus);
      const penalty = Math.min(
        0.7,
        (itemFeedback?.quickSkips ?? 0) * 0.12 + (itemFeedback?.impressions ?? 0) * 0.015,
      );
      return { item, score: item.weight + bonus - penalty + rng() * 0.05 };
    })
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item);
}

export function catalogFromEnvironment(value: string | undefined): YouTubeShortsCatalog | null {
  if (!value) return null;
  const generatedAt = new Date().toISOString();
  const ids = [...new Set(value.split(',').map((id) => id.trim()).filter((id) => VIDEO_ID.test(id)))];
  return ids.length > 0
    ? {
        schemaVersion: 1,
        generatedAt,
        videos: ids.map((videoId) => ({
          id: videoId,
          videoId,
          category: 'other',
          weight: 1,
          enabled: true,
          addedAt: generatedAt,
        })),
      }
    : null;
}
