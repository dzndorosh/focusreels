import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (file) => readFileSync(join(root, file), 'utf8');
const html = read('src/app/renderer/control-center.html');
const renderer = read('src/app/renderer/control-center.js');
const main = read('src/app/main.ts');
const settings = read('src/app/settings.ts');
const settingsIpc = read('src/app/settingsIpc.ts');
const controlCenter = read('src/app/settingsWindow.ts');
const checks = [
  ['master enabled toggle', html.includes('id="enabled"') && renderer.includes('update({ enabled:')],
  ['sound toggle', html.includes('id="muted"') && renderer.includes('update({ muted:')],
  ['always-on-top toggle', html.includes('id="alwaysOnTop"') && renderer.includes('update({ alwaysOnTop:')],
  ['launch-at-login toggle', html.includes('id="launchAtLogin"') && renderer.includes('update({ launchAtLogin:')],
  ['source toggles', html.includes('data-source="cursor"') && renderer.includes('settings.sources')],
  ['settings fields are typed', settings.includes('alwaysOnTop: boolean') && settings.includes('launchAtLogin: boolean')],
  ['validated settings updates', settingsIpc.includes("'alwaysOnTop'") && settingsIpc.includes("'launchAtLogin'") && settingsIpc.includes("patch.sources")],
  ['login item integration', main.includes('setLoginItemSettings')],
  ['Control Center stays above video stage', controlCenter.includes("win.setAlwaysOnTop(true, 'screen-saver', 1)")],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
