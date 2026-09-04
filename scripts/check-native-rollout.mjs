import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (file) => readFileSync(join(root, file), 'utf8');
const checks = [];
const expect = (name, value) => checks.push({ name, ok: Boolean(value) });

const windowSource = read('src/app/youtubeWindow.ts');
const rendererSource = read('src/app/renderer/youtube.js');
const nativeSource = read('src/app/renderer/nativeFeed.js');
const htmlSource = read('src/app/renderer/youtube.html');

expect('native path has an explicit legacy escape', /FOCUSREELS_LEGACY_SCROLL/.test(windowSource));
expect('native renderer script is mounted', htmlSource.includes('<script src="nativeFeed.js"></script>'));
expect('renderer gates native mode by URL flag',
  /NATIVE_SCROLL_ENABLED = new URLSearchParams\(location\.search\)\.get\('nativeScroll'\) === '1'/.test(rendererSource));
expect('legacy wheel listener is disabled in native mode',
  /if \(!NATIVE_SCROLL_ENABLED\) wheelCatcher\.addEventListener\('wheel'/.test(rendererSource));
expect('native feed has CSS snap',
  /scroll-snap-type:\s*y mandatory/.test(htmlSource) && /scroll-snap-stop:\s*always/.test(htmlSource));
expect('native feed uses stable player array',
  /players\[index\] = player/.test(nativeSource) && !/\.destroy\s*\(/.test(nativeSource));
expect('native feed does not install wheel listener',
  !/addEventListener\(['"]wheel['"]/.test(nativeSource));

const failed = checks.filter((check) => !check.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
if (failed.length) process.exitCode = 1;
