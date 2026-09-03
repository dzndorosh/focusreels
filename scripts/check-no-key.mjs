/**
 * Build-time guardrail: the API key must never reach client-side JavaScript.
 *
 * Greps every renderer asset for the key's *value* (the variable's name is fine
 * — it appears in a help string). Runs on every build so this cannot regress.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rendererDir = join(root, 'dist', 'app', 'renderer');

function keyFromEnvFile() {
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*YOUTUBE_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

const key = (process.env.YOUTUBE_API_KEY ?? keyFromEnvFile() ?? '').trim();
if (!existsSync(rendererDir)) process.exit(0);

const files = readdirSync(rendererDir).map((f) => join(rendererDir, f));
const offenders = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  // Any Google API key shape, not just this machine's — a hardcoded one counts.
  if (/AIza[0-9A-Za-z_-]{20,}/.test(text)) offenders.push(`${file}: looks like a Google API key`);
  if (key.length >= 8 && text.includes(key)) offenders.push(`${file}: contains the configured key`);
}

if (offenders.length > 0) {
  console.error('API key leaked into the renderer:\n  ' + offenders.join('\n  '));
  process.exit(1);
}
console.log(`no API key in renderer (${files.length} files checked)`);
