import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/catalog-youtube-permanent.ts');
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'focusreels-permanent-cli-'));
  mkdirSync(join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'artifacts/youtube-catalog'), { recursive: true });
  writeFileSync(join(dir, 'config/youtube-sources.json'), JSON.stringify({ schemaVersion: 1, maxVideoAgeDays: 30, catalogLimit: 200, sources: [{ channelId: 'UCold', category: 'other', weight: 1, enabled: true, maxVideos: 10 }] }));
  writeFileSync(join(dir, 'config/youtube-video-blocklist.json'), '{"schemaVersion":1,"videoIds":[]}');
  return dir;
};
const run = (mode: string, cwd: string) => execFileSync(process.execPath, ['--experimental-strip-types', script, mode], { cwd, env: { ...process.env, YOUTUBE_API_KEY: '' }, encoding: 'utf8', stdio: 'pipe' });

describe('permanent catalog CLI', () => {
  it('applies review without an API key and creates a backup', () => {
    const cwd = project();
    writeFileSync(join(cwd, 'artifacts/youtube-catalog/permanent-channel-review.json'), JSON.stringify({ channels: [{ channelId: 'UCnew', category: 'gaming', decision: 'approve-channel' }] }));
    expect(() => run('apply', cwd)).not.toThrow();
    expect(JSON.parse(readFileSync(join(cwd, 'config/youtube-sources.json'), 'utf8')).sources[0].channelId).toBe('UCnew');
    expect(JSON.parse(readFileSync(join(cwd, 'artifacts/youtube-catalog/youtube-sources.backup.json'), 'utf8')).sources[0].channelId).toBe('UCold');
  });
  it('rejects an empty review without changing the allowlist', () => {
    const cwd = project(); const path = join(cwd, 'config/youtube-sources.json'); const before = readFileSync(path, 'utf8');
    writeFileSync(join(cwd, 'artifacts/youtube-catalog/permanent-channel-review.json'), '{"channels":[]}');
    expect(() => run('apply', cwd)).toThrow(); expect(readFileSync(path, 'utf8')).toBe(before);
  });
  it('auto-approve keeps the existing allowlist and adds channels over the threshold', () => {
    const cwd = project();
    writeFileSync(join(cwd, 'artifacts/youtube-catalog/permanent-candidates.json'), JSON.stringify({ channels: [
      { channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', channelTitle: 'Rich', handle: '@rich', category: 'technology', weight: 1, eligible: [1, 2, 3], rejected: [1] },
      { channelId: 'UCbbbbbbbbbbbbbbbbbbbbbb', channelTitle: 'Thin', handle: '@thin', category: 'humor', weight: 1, eligible: [1], rejected: [1, 2] },
    ] }));
    run('auto-approve', cwd);
    const review = JSON.parse(readFileSync(join(cwd, 'artifacts/youtube-catalog/permanent-channel-review.json'), 'utf8'));
    const approved = review.channels.filter((c: any) => c.decision === 'approve-channel').map((c: any) => c.channelId);
    expect(approved).toContain('UCold');
    expect(approved).toContain('UCaaaaaaaaaaaaaaaaaaaaaa');
    expect(approved).not.toContain('UCbbbbbbbbbbbbbbbbbbbbbb');
    run('apply', cwd);
    const sources = JSON.parse(readFileSync(join(cwd, 'config/youtube-sources.json'), 'utf8')).sources.map((s: any) => s.channelId);
    expect(sources).toEqual(['UCold', 'UCaaaaaaaaaaaaaaaaaaaaaa']);
  });
  it('auto-approve without candidates fails closed', () => expect(() => run('auto-approve', project())).toThrow());
  it.each(['resolve', 'collect'])('%s requires an API key', (mode) => expect(() => run(mode, project())).toThrow());
  it('rejects unknown modes', () => expect(() => run('wat', project())).toThrow());
});
