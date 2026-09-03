import { describe, expect, it } from 'vitest';
import { parseBrokenVideoId, parseFeedback } from '../src/app/feedIpc.js';

describe('feed IPC validation', () => {
  it('rebuilds valid feedback and drops unrelated renderer fields', () => {
    expect(
      parseFeedback({
        videoId: 'abc123',
        category: 'humor',
        impressions: 1,
        completedViews: 0,
        quickSkips: 0,
        secret: 'must not persist',
      }),
    ).toEqual({
      videoId: 'abc123',
      category: 'humor',
      impressions: 1,
      completedViews: 0,
      quickSkips: 0,
    });
  });

  it('rejects malformed feedback and broken-video reports', () => {
    expect(parseFeedback({ videoId: 'abc123', category: 'nope' })).toBeNull();
    expect(parseFeedback({ videoId: 'abc123', category: 'humor', impressions: -1 })).toBeNull();
    expect(parseBrokenVideoId({ videoId: '/private/prompt' })).toBeNull();
  });
});
