/** The only shape that ever crosses into the renderer. No key, no raw API. */
export interface FeedVideo {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSeconds: number;
  source: 'search' | 'popular' | 'demo';
  category?: 'humor' | 'gaming' | 'animals' | 'technology' | 'music_art' | 'other';
}

export interface FeedStatus {
  /** true when the API is unavailable and we are playing local clips */
  demoMode: boolean;
  /** why we fell back, in one short phrase — shown to the user as-is */
  reason: string | null;
  queued: number;
  provider?: 'youtube-catalog' | 'legacy' | 'empty';
  catalogSource?: 'environment' | 'development-file' | 'fixture' | 'cache' | 'remote' | null;
  totalVideos?: number;
  playableVideos?: number;
}
