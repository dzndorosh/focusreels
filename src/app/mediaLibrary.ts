import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { mediaDir } from '../broker/paths.js';

const PLAYABLE = new Set(['.mp4', '.m4v', '.mov', '.webm']);

/** Absolute paths of the user's own clips. Nothing is ever downloaded. */
export function playlist(dir: string = mediaDir()): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith('.') && PLAYABLE.has(extname(name).toLowerCase()))
      .map((name) => join(dir, name))
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}
