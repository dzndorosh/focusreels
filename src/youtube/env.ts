/**
 * Reads YOUTUBE_API_KEY, and only in the main process.
 *
 * Order: a real environment variable wins, then a `.env` next to the app, then
 * one in the app's support directory (so a packaged build has somewhere to put
 * it). Deliberately tiny — a dotenv dependency would buy nothing here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { supportDir } from '../broker/paths.js';

const KEY = 'YOUTUBE_API_KEY';

function fromFile(file: string): string | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== KEY) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.length > 0 ? value : null;
  }
  return null;
}

export function readApiKey(appRoot: string): string | null {
  const fromEnv = process.env[KEY];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return fromFile(join(appRoot, '.env')) ?? fromFile(join(supportDir(), '.env'));
}

/** Never log a key. This is what goes in a log line instead. */
export function describeKey(key: string | null): string {
  return key ? `present (${key.length} chars)` : 'missing';
}
