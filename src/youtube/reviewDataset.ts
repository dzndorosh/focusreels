export type ReviewItem = { id: string; videoId: string; category: string; weight: number; enabled: boolean; addedAt: string };
export type SeedVideo = { videoId: string; channelId?: string; channelTitle?: string; title?: string; duration?: string; publishedAt?: string };
export function buildReviewDataset(catalog: { videos?: ReviewItem[] } | null | undefined, seed: { videos?: SeedVideo[] } | null | undefined): ReviewItem[] {
  const items = Array.isArray(catalog?.videos) ? catalog!.videos : [];
  const byId = new Map(items.filter(v => v && typeof v.videoId === 'string').map(v => [v.videoId, v]));
  for (const video of seed?.videos ?? []) if (video?.videoId && !byId.has(video.videoId)) byId.set(video.videoId, { id: video.videoId, videoId: video.videoId, category: 'other', weight: 1, enabled: true, addedAt: video.publishedAt || new Date(0).toISOString() });
  return [...byId.values()];
}
