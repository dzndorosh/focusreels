import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { supportDir } from '../broker/paths.js';
import {
  CATEGORIES,
  catalogFromEnvironment,
  EMPTY_CATALOG,
  fetchRemoteCatalog,
  loadCatalog,
  rankCatalog,
  type LocalFeedback,
  validateCatalog,
  type YouTubeShortsCatalog,
} from './catalog.js';
import type { FeedStatus, FeedVideo } from './types.js';

type CatalogSource = 'environment' | 'development-file' | 'cache' | 'remote';

export interface CatalogProviderOptions {
  /** Injection makes filesystem-dependent behavior testable without Electron. */
  supportDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  cwd?: string;
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readDevelopmentCatalog(environment: NodeJS.ProcessEnv): YouTubeShortsCatalog | null {
  if (environment.NODE_ENV === 'production') return null;
  const path = environment.FOCUSREELS_YOUTUBE_TEST_CATALOG_PATH;
  if (!path) return null;
  if (!path.startsWith('/') || path.includes('..')) {
    throw new Error('FOCUSREELS_YOUTUBE_TEST_CATALOG_PATH must be an explicit absolute path');
  }
  if (environment.FOCUSREELS_YOUTUBE_TEST_IDS) {
    throw new Error('Set either FOCUSREELS_YOUTUBE_TEST_IDS or FOCUSREELS_YOUTUBE_TEST_CATALOG_PATH, not both');
  }
  const catalog = validateCatalog(readJson(path));
  if (!catalog) throw new Error(`Invalid development catalog: ${path}`);
  return catalog;
}

function isFeedback(value: unknown): value is LocalFeedback {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const feedback = value as Record<string, unknown>;
  return (
    typeof feedback.videoId === 'string' &&
    typeof feedback.category === 'string' &&
    (CATEGORIES as readonly string[]).includes(feedback.category) &&
    typeof feedback.impressions === 'number' &&
    Number.isFinite(feedback.impressions) &&
    feedback.impressions >= 0 &&
    typeof feedback.completedViews === 'number' &&
    Number.isFinite(feedback.completedViews) &&
    feedback.completedViews >= 0 &&
    typeof feedback.quickSkips === 'number' &&
    Number.isFinite(feedback.quickSkips) &&
    feedback.quickSkips >= 0
  );
}

function readFeedback(path: string): LocalFeedback[] {
  const value = readJson(path);
  return Array.isArray(value) ? value.filter(isFeedback) : [];
}

function writeAtomically(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, path);
}

export class CatalogProvider {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly directory: string;
  private readonly envCatalog: YouTubeShortsCatalog | null;
  private readonly fileCatalog: YouTubeShortsCatalog | null;
  private source: CatalogSource;
  private catalog: YouTubeShortsCatalog;
  private readonly seen = new Set<string>();
  private readonly broken = new Set<string>();
  private history: FeedVideo[] = [];
  private cursor = -1;
  private feedback: LocalFeedback[] = [];
  private ordered: FeedVideo[] | null = null;

  constructor(options: CatalogProviderOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.directory = options.supportDirectory ?? supportDir();
    this.envCatalog =
      this.environment.NODE_ENV !== 'production'
        ? catalogFromEnvironment(this.environment.FOCUSREELS_YOUTUBE_TEST_IDS)
        : null;
    this.fileCatalog = readDevelopmentCatalog(this.environment);
    this.source = this.envCatalog ? 'environment' : this.fileCatalog ? 'development-file' : 'cache';
    const fixture = validateCatalog(
      readJson(join(options.cwd ?? process.cwd(), 'config/youtube-catalog.fixture.json')),
    );
    this.catalog =
      this.envCatalog ??
      this.fileCatalog ??
      loadCatalog({
        fallback: fixture ?? EMPTY_CATALOG,
        cacheFile: join(this.directory, 'youtube-catalog.json'),
      });

    try {
      mkdirSync(this.directory, { recursive: true });
      this.feedback = readFeedback(join(this.directory, 'youtube-feedback.json'));
    } catch {
      // A catalog failure must leave the player empty, not crash Electron.
    }
  }

  private invalidate(): void {
    this.ordered = null;
  }

  private items(): FeedVideo[] {
    if (this.ordered) return this.ordered;

    const ranked =
      this.environment.NODE_ENV !== 'production' && this.environment.FOCUSREELS_E2E && this.envCatalog
        ? this.catalog.videos.filter(
            (video) =>
              video.enabled &&
              !this.seen.has(video.videoId) &&
              !this.broken.has(video.videoId) &&
              !this.feedback.find((item) => item.videoId === video.videoId)?.hidden,
          )
        : this.rankNextLap();

    this.ordered = ranked.map((video) => ({
      id: video.videoId,
      title: '',
      channelId: '',
      channelTitle: '',
      thumbnailUrl: '',
      durationSeconds: 0,
      source: 'search',
      category: video.category,
    }));
    return this.ordered;
  }

  private rankNextLap() {
    let ranked = rankCatalog(this.catalog.videos, this.feedback, this.seen);
    if (ranked.length === 0 && this.catalog.videos.length > 0) {
      this.seen.clear();
      ranked = rankCatalog(this.catalog.videos, this.feedback, this.seen);
    }
    return ranked.filter((video) => !this.broken.has(video.videoId));
  }

  async next(): Promise<FeedVideo | null> {
    if (this.cursor < this.history.length - 1) {
      this.cursor += 1;
      return this.history[this.cursor] ?? null;
    }
    const video = this.items()[0] ?? null;
    if (!video) return null;
    this.seen.add(video.id);
    this.invalidate();
    this.history.push(video);
    this.cursor = this.history.length - 1;
    return video;
  }

  previous(): FeedVideo | null {
    if (this.cursor <= 0) return null;
    this.cursor -= 1;
    return this.history[this.cursor] ?? null;
  }

  peek(): FeedVideo | null {
    return this.items()[0] ?? null;
  }

  refresh(): FeedStatus {
    this.seen.clear();
    this.broken.clear();
    this.history = [];
    this.cursor = -1;
    this.invalidate();
    return this.status;
  }

  markBroken(videoId: string): void {
    this.broken.add(videoId);
    this.invalidate();
    if (this.environment.FOCUSREELS_DEBUG_FEED) console.log('[feed] unavailable', { videoId });
  }

  get status(): FeedStatus {
    const playable = this.items().length;
    const total = this.catalog.videos.length;
    return {
      demoMode: false,
      reason: total > 0 ? '' : 'Add test YouTube Shorts IDs to run the catalog demo.',
      queued: playable,
      provider: total > 0 ? 'youtube-catalog' : 'empty',
      catalogSource: total > 0 ? this.source : null,
      totalVideos: total,
      playableVideos: playable,
    };
  }

  setFeedback(feedback: LocalFeedback): void {
    const previous = this.feedback.find((item) => item.videoId === feedback.videoId);
    const merged: LocalFeedback = {
      ...previous,
      ...feedback,
      impressions: (previous?.impressions ?? 0) + feedback.impressions,
      completedViews: (previous?.completedViews ?? 0) + feedback.completedViews,
      quickSkips: (previous?.quickSkips ?? 0) + feedback.quickSkips,
    };
    this.feedback = [...this.feedback.filter((item) => item.videoId !== feedback.videoId), merged];
    this.invalidate();
    try {
      writeAtomically(join(this.directory, 'youtube-feedback.json'), this.feedback);
    } catch {
      // Feedback can improve ranking but never justify interrupting playback.
    }
  }

  async refreshRemote(url?: string): Promise<boolean> {
    if (this.envCatalog || !url) return false;
    const etagPath = join(this.directory, 'youtube-catalog.etag');
    const etag = existsSync(etagPath) ? readFileSync(etagPath, 'utf8').trim() || undefined : undefined;
    const result = await fetchRemoteCatalog(url, 4_000, etag);
    if (result.notModified) return true;
    if (!result.catalog) return false;

    this.catalog = result.catalog;
    this.source = 'remote';
    this.invalidate();
    try {
      writeAtomically(join(this.directory, 'youtube-catalog.json'), this.catalog);
      if (result.etag) writeFileSync(etagPath, result.etag);
    } catch {
      // Runtime catalog remains valid even if its cache cannot be updated.
    }
    return true;
  }
}
