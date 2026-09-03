import { describe, expect, it } from 'vitest';
import { formatFeedLine } from '../src/app/feedLine.js';
import type { FeedStatus } from '../src/youtube/types.js';

const NOW = Date.parse('2026-09-04T12:00:00.000Z');

const status = (patch: Partial<FeedStatus> = {}): FeedStatus => ({
  demoMode: false,
  reason: null,
  queued: 412,
  totalVideos: 448,
  catalogSource: 'remote',
  generatedAt: '2026-09-04T06:00:00.000Z',
  ...patch,
});

describe('formatFeedLine', () => {
  it('names the demo mode and its reason', () => {
    expect(formatFeedLine(status({ demoMode: true, reason: 'no API key' }), NOW)).toBe(
      'Demo mode · no API key',
    );
  });

  it('says how many videos are playable out of how many are known', () => {
    expect(formatFeedLine(status(), NOW)).toBe('Feed: 412 of 448 · published 6h ago');
  });

  it('counts a fresh catalog in hours and an old one in days', () => {
    expect(formatFeedLine(status({ generatedAt: '2026-09-01T12:00:00.000Z' }), NOW)).toBe(
      'Feed: 412 of 448 · published 3d ago',
    );
  });

  it('calls a catalog published within the hour current', () => {
    expect(formatFeedLine(status({ generatedAt: '2026-09-04T11:30:00.000Z' }), NOW)).toBe(
      'Feed: 412 of 448 · published just now',
    );
  });

  it('does not report a negative age when the clock is skewed', () => {
    // A machine whose clock is behind the build server must not read "-3h ago".
    expect(formatFeedLine(status({ generatedAt: '2026-09-04T18:00:00.000Z' }), NOW)).toBe(
      'Feed: 412 of 448 · published just now',
    );
  });

  it('marks any local catalog as a bundled snapshot', () => {
    expect(formatFeedLine(status({ catalogSource: 'cache' }), NOW)).toBe(
      'Feed: 412 of 448 · bundled snapshot',
    );
    expect(formatFeedLine(status({ catalogSource: null }), NOW)).toBe(
      'Feed: 412 of 448 · bundled snapshot',
    );
  });

  it('drops the age when the catalog does not carry a usable timestamp', () => {
    expect(formatFeedLine(status({ generatedAt: undefined }), NOW)).toBe('Feed: 412 of 448');
    expect(formatFeedLine(status({ generatedAt: 'not a date' }), NOW)).toBe('Feed: 412 of 448');
  });

  it('falls back to the queued count when the total is unknown', () => {
    expect(formatFeedLine(status({ totalVideos: undefined, catalogSource: 'cache' }), NOW)).toBe(
      'Feed: 412 of 412 · bundled snapshot',
    );
  });
});
