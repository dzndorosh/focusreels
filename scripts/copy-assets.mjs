// tsc only emits .ts; the renderer and the tray icon just get copied.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src', 'app', 'renderer');
const to = join(root, 'dist', 'app', 'renderer');

mkdirSync(to, { recursive: true });
for (const file of ['player.html', 'player.js', 'youtube.html', 'youtube.js', 'settings.html', 'settings.js']) {
  cpSync(join(from, file), join(to, file));
}

const assetsFrom = join(root, 'src', 'app', 'assets');
if (existsSync(assetsFrom)) {
  cpSync(assetsFrom, join(root, 'dist', 'app', 'assets'), { recursive: true });
}

console.log('copied renderer assets ->', to);
