/**
 * Generates the menu-bar icon as a macOS *template* image: black pixels plus
 * alpha, which the system recolours for light/dark menu bars.
 *
 * An empty nativeImage with only a setTitle() is not reliably rendered by
 * macOS, so the tray needs a real file. Run: node scripts/make-tray-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'assets');

/** A reel: a ring with a solid hub — legible down to 16px. */
function alphaAt(x, y, size) {
  const c = (size - 1) / 2;
  const r = Math.hypot(x - c, y - c) / (size / 2);
  const ringOuter = 0.92;
  const ringInner = 0.62;
  const hub = 0.26;

  // soft edges: one pixel of falloff at each boundary
  const edge = 1.4 / size;
  const band = (lo, hi) =>
    Math.min(smooth(r, lo - edge, lo + edge), 1 - smooth(r, hi - edge, hi + edge));

  const ring = band(ringInner, ringOuter);
  const centre = 1 - smooth(r, hub - edge, hub + edge);
  return Math.max(0, Math.min(1, Math.max(ring, centre)));
}

function smooth(v, lo, hi) {
  if (v <= lo) return 0;
  if (v >= hi) return 1;
  const t = (v - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y += 1) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      // supersample 3x3 so the ring does not alias into mush at 16px
      let a = 0;
      for (let sy = 0; sy < 3; sy += 1) {
        for (let sx = 0; sx < 3; sx += 1) {
          a += alphaAt(x + (sx + 0.5) / 3 - 0.5, y + (sy + 0.5) / 3 - 0.5, size);
        }
      }
      raw[p++] = 0;
      raw[p++] = 0;
      raw[p++] = 0;
      raw[p++] = Math.round((a / 9) * 255);
    }
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'trayTemplate.png'), png(16));
writeFileSync(join(outDir, 'trayTemplate@2x.png'), png(32));
console.log('wrote tray icons ->', outDir);
