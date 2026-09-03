import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Category = 'humor' | 'gaming' | 'animals' | 'technology' | 'music_art' | 'other';
type Source = { channelId: string; category: Category; weight: number; enabled: boolean; maxVideos: number };
type Config = { schemaVersion: 1; maxVideoAgeDays: number; catalogLimit: number; sources: Source[] };
type Item = { id: string; videoId: string; category: Category; weight: number; enabled: true; addedAt: string };

const root = process.cwd();
const apiKey = process.env.YOUTUBE_API_KEY;
const diagnostic = join(root, 'artifacts', 'youtube-catalog');
const fail = (message: string): never => { mkdirSync(diagnostic, { recursive: true }); writeFileSync(join(diagnostic, 'last-error.json'), JSON.stringify({ message, at: new Date().toISOString() }, null, 2)); console.error(message); process.exit(1); };
if (!apiKey) fail('Missing YOUTUBE_API_KEY (maintainer-only). No catalog written.');
let config: Config;
try { config = JSON.parse(readFileSync(join(root, 'config/youtube-sources.json'), 'utf8')); } catch { fail('Invalid config/youtube-sources.json'); }
if (config!.schemaVersion !== 1 || !Array.isArray(config!.sources)) fail('Invalid config/youtube-sources.json');
let block: { schemaVersion: number; videoIds: string[] };
try { block = JSON.parse(readFileSync(join(root, 'config/youtube-video-blocklist.json'), 'utf8')); } catch { fail('Invalid config/youtube-video-blocklist.json'); }
if (block!.schemaVersion !== 1 || !Array.isArray(block!.videoIds)) fail('Invalid config/youtube-video-blocklist.json');
const blocked = new Set(block!.videoIds);
const api = 'https://www.googleapis.com/youtube/v3';
async function request(path: string, params: Record<string, string>): Promise<any> { const u = new URL(`${api}/${path}`); Object.entries({ ...params, key: apiKey! }).forEach(([k, v]) => u.searchParams.set(k, v)); const response = await fetch(u); if (!response.ok) throw new Error(`YouTube API ${response.status} (${path})`); return response.json(); }
function seconds(value: string): number { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value); return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0; }
async function allPages(playlistId: string, limit: number): Promise<any[]> { const output: any[] = []; let token = ''; do { const page = await request('playlistItems', { part: 'snippet,contentDetails', playlistId, maxResults: '50', ...(token ? { pageToken: token } : {}) }); output.push(...(page.items || [])); token = page.nextPageToken || ''; } while (token && output.length < limit); return output.slice(0, limit); }
function atomic(path: string, value: unknown): void { const temporary = `${path}.tmp`; writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n'); JSON.parse(readFileSync(temporary, 'utf8')); renameSync(temporary, path); }

async function main(): Promise<void> {
  const sources = config.sources.filter(s => s.enabled && /^UC[\w-]{20,}$/.test(s.channelId));
  if (!sources.length) fail('Allowlist empty: add verified UC... channel IDs to config/youtube-sources.json');
  const cutoff = Date.now() - config.maxVideoAgeDays * 86400000;
  const candidates: Array<Item & { channelId: string }> = [];
  const diagnostics = { checked: 0, rejected: 0, duplicateIds: 0, unavailableEmbedding: 0, sources: sources.length };
  for (const source of sources) {
    const channel = (await request('channels', { part: 'contentDetails', id: source.channelId })).items?.[0];
    if (!channel?.contentDetails?.relatedPlaylists?.uploads) throw new Error(`Channel not found or has no uploads: ${source.channelId}`);
    const posts = await allPages(channel.contentDetails.relatedPlaylists.uploads, source.maxVideos);
    const ids = posts.map(p => p.contentDetails?.videoId).filter(Boolean) as string[];
    for (let i = 0; i < ids.length; i += 50) {
      const response = await request('videos', { part: 'snippet,contentDetails,status', id: ids.slice(i, i + 50).join(',') });
      for (const video of response.items || []) {
        diagnostics.checked++;
        const published = Date.parse(video.snippet?.publishedAt || '');
        const duration = seconds(video.contentDetails?.duration || '');
        if (video.status?.embeddable !== true) diagnostics.unavailableEmbedding++;
        if (!video.id || blocked.has(video.id) || video.status?.privacyStatus !== 'public' || video.status?.embeddable !== true || video.snippet?.liveBroadcastContent !== 'none' || duration < 3 || duration > 180 || !Number.isFinite(published) || published < cutoff) { diagnostics.rejected++; continue; }
        candidates.push({ id: video.id, videoId: video.id, category: source.category, weight: source.weight, enabled: true, addedAt: new Date(published).toISOString(), channelId: source.channelId });
      }
    }
  }
  if (diagnostics.checked && diagnostics.unavailableEmbedding / diagnostics.checked > 0.2) throw new Error(`Refusing publication: ${(diagnostics.unavailableEmbedding / diagnostics.checked * 100).toFixed(1)}% videos are not embeddable`);
  const duplicateCount = candidates.length - new Set(candidates.map(v => v.videoId)).size; diagnostics.duplicateIds = duplicateCount; if (duplicateCount) throw new Error(`Duplicate video IDs detected: ${duplicateCount}`);
  const previousPath = join(root, 'config/youtube-catalog.json'); let previous: { videos?: Item[] } | null = null; try { previous = JSON.parse(readFileSync(previousPath, 'utf8')); } catch { /* first run */ }
  if (!candidates.length && !previous?.videos?.length) throw new Error('Refusing to publish empty catalog');
  // Preserve still-fresh entries from the last valid catalog when a channel has
  // no new uploads; stale and blocklisted items are intentionally dropped.
  for (const old of previous?.videos || []) {
    if (!old?.videoId || blocked.has(old.videoId) || Date.parse(old.addedAt || '') < cutoff) continue;
    if (!candidates.some(v => v.videoId === old.videoId)) candidates.push({ ...old, channelId: 'previous' });
  }
  if (previous?.videos?.length && candidates.length < previous.videos.length * 0.5) throw new Error(`Refusing >50% catalog drop (${previous.videos.length} -> ${candidates.length})`);
  const unique = [...new Map(candidates.map(v => [v.videoId, v])).values()];
  const channelCap = Math.max(1, Math.ceil(config.catalogLimit * 0.4)); const counts = new Map<string, number>();
  const videos = unique.filter(v => { const count = counts.get(v.channelId) || 0; if (count >= channelCap) return false; counts.set(v.channelId, count + 1); return true; }).sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.videoId.localeCompare(b.videoId)).slice(0, config.catalogLimit).map(({ channelId: _channelId, ...item }) => item);
  if (!videos.length) throw new Error('Refusing to publish empty catalog after limits');
  const catalog = { schemaVersion: 1 as const, generatedAt: new Date().toISOString(), videos };
  mkdirSync(join(root, 'public/catalog'), { recursive: true }); mkdirSync(join(root, 'artifacts/youtube-catalog'), { recursive: true });
  atomic(previousPath, catalog); atomic(join(root, 'public/catalog/youtube-catalog.json'), catalog);
  const categoryCounts = videos.reduce<Record<string, number>>((result, item) => { result[item.category] = (result[item.category] || 0) + 1; return result; }, {});
  atomic(join(root, 'public/catalog/status.json'), { generatedAt: catalog.generatedAt, totalVideos: videos.length, sourceCount: sources.length, categoryCounts, schemaVersion: 1 });
  atomic(join(root, 'artifacts/youtube-catalog/diagnostics.json'), diagnostics);
  console.log(`catalog written: ${videos.length} videos from ${sources.length} channels`);
}
main().catch(error => fail(error instanceof Error ? error.message : String(error)));
