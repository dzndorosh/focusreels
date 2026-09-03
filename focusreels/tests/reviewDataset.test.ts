import { describe, expect, it } from 'vitest';
import { buildReviewDataset } from '../src/youtube/reviewDataset.js';
describe('review dataset', () => {
  it('merges empty catalog with eight seed videos', () => {
    const seed = { videos: Array.from({ length: 8 }, (_, i) => ({ videoId: `seed${i}xx`, publishedAt: '2026-01-01T00:00:00Z' })) };
    expect(buildReviewDataset({ videos: [] }, seed)).toHaveLength(8);
  });
  it('deduplicates catalog and seed by videoId', () => {
    expect(buildReviewDataset({ videos: [{ id: 'same123', videoId: 'same123', category: 'other', weight: 1, enabled: true, addedAt: 'now' }] }, { videos: [{ videoId: 'same123' }, { videoId: 'new123' }] })).toHaveLength(2);
  });
});
