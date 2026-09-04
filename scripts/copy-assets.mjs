// tsc only emits .ts; the renderer and the tray icon just get copied.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src', 'app', 'renderer');
const to = join(root, 'dist', 'app', 'renderer');

mkdirSync(to, { recursive: true });
for (const file of ['player.html', 'player.js', 'youtube.html', 'youtube.js', 'wheelGesture.js', 'nativeFeed.js', 'control-center.html', 'control-center.css', 'control-center.js', 'settings.html', 'settings.js']) {
  cpSync(join(from, file), join(to, file));
}

const assetsFrom = join(root, 'src', 'app', 'assets');
if (existsSync(assetsFrom)) {
  cpSync(assetsFrom, join(root, 'dist', 'app', 'assets'), { recursive: true });
}

console.log('copied renderer assets ->', to);

if (process.platform === 'darwin') {
  const nativeTo = join(root, 'dist', 'native');
  mkdirSync(nativeTo, { recursive: true });
  for (const [arch, target] of [['arm64', 'arm64-apple-macosx13.0'], ['x64', 'x86_64-apple-macosx13.0']]) {
    try {
      execFileSync('swiftc', ['scripts/audio-activity.swift', '-target', target, '-framework', 'CoreAudio', '-o', join(nativeTo, `focusreels-audio-activity-${arch}`)], { cwd: root, stdio: 'pipe' });
    } catch (error) {
      console.warn(`[focusreels] audio helper unavailable for ${arch}:`, error?.message ?? error);
    }
  }
}
