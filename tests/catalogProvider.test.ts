import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogProvider } from '../src/youtube/catalogProvider.js';

const ids = (count: number) => Array.from({ length: count }, (_, i) => `video${String(i).padStart(3, '0')}`);
const catalog = (count: number) => ({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  videos: ids(count).map((videoId, i) => ({ id: videoId, videoId, category: 'other' as const, weight: 1, enabled: true, addedAt: new Date(Date.now() - i * 3600000).toISOString() })),
});

// A fresh support dir per provider keeps the real feedback file out of the run,
// and keeps one test's accumulated impressions from ranking the next one.
const provider = (count: number) => {
  const dir = mkdtempSync(join(tmpdir(), 'focusreels-provider-'));
  const path = join(dir, 'catalog.json');
  writeFileSync(path, JSON.stringify(catalog(count)));
  process.env.FOCUSREELS_E2E_USER_DATA = dir;
  process.env.FOCUSREELS_YOUTUBE_TEST_CATALOG_PATH = path;
  return new CatalogProvider();
};
const drain = async (p: CatalogProvider, n: number) => { const out: (string | undefined)[] = []; for (let i = 0; i < n; i++) out.push((await p.next())?.id); return out; };

describe('CatalogProvider ordering', () => {
  beforeEach(() => { delete process.env.FOCUSREELS_E2E; delete process.env.FOCUSREELS_YOUTUBE_TEST_IDS; });
  afterEach(() => {
    delete process.env.FOCUSREELS_E2E_USER_DATA;
    delete process.env.FOCUSREELS_YOUTUBE_TEST_CATALOG_PATH;
    vi.restoreAllMocks();
  });

  it('does not serve the catalog in file order', async () => {
    const runs = await Promise.all([drain(provider(40), 40), drain(provider(40), 40), drain(provider(40), 40)]);
    expect(runs.some(run => run.join() === ids(40).join())).toBe(false);
  });

  it('draws a different order on each run', async () => {
    const a = await drain(provider(40), 40);
    const b = await drain(provider(40), 40);
    expect(a.join()).not.toBe(b.join());
  });

  it('peek returns exactly what next then plays, so the preloaded slot is the one promoted', async () => {
    const p = provider(40);
    for (let i = 0; i < 10; i++) {
      const staged = p.peek()?.id;
      expect(staged).toBeTruthy();
      expect((await p.next())?.id).toBe(staged);
    }
  });

  it('never runs dry: a new lap starts once every clip has been shown', async () => {
    const played = await drain(provider(5), 12);
    expect(played.filter(Boolean)).toHaveLength(12);
    expect(new Set(played.slice(0, 5)).size).toBe(5);
  });

  it('does not let corrupted persisted feedback hide the whole catalog', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'focusreels-provider-'));
    const path = join(dir, 'catalog.json');
    writeFileSync(path, JSON.stringify(catalog(2)));
    writeFileSync(join(dir, 'youtube-feedback.json'), JSON.stringify([
      { videoId: 'video000', category: 'other', impressions: 'many' },
    ]));

    const p = new CatalogProvider({
      supportDirectory: dir,
      environment: {
        NODE_ENV: 'test',
        FOCUSREELS_YOUTUBE_TEST_CATALOG_PATH: path,
      },
    });

    expect((await p.next())?.id).toBeTruthy();
  });

  it('uses the shipped catalog on a first offline launch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'focusreels-provider-'));
    const path = join(dir, 'bundled.json');
    writeFileSync(path, JSON.stringify(catalog(3)));

    const p = new CatalogProvider({
      supportDirectory: join(dir, 'support'),
      environment: { NODE_ENV: 'production' },
      cwd: dir,
      fallbackCatalogPath: path,
    });

    expect(p.status).toMatchObject({ catalogSource: 'cache', totalVideos: 3, queued: 3 });
  });

  it('reports a remote catalog after a successful refresh', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'focusreels-provider-'));
    const remote = catalog(2);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(remote), { headers: { etag: '"catalog-v1"' } }),
    );
    const p = new CatalogProvider({
      supportDirectory: dir,
      environment: { NODE_ENV: 'test' },
      cwd: dir,
    });

    await expect(p.refreshRemote('https://catalog.example.test/feed.json')).resolves.toBe(true);
    expect(p.status).toMatchObject({
      catalogSource: 'remote',
      generatedAt: remote.generatedAt,
      totalVideos: 2,
    });
  });
});
