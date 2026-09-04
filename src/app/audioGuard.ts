import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Best-effort snapshot before a new feed session; never blocks or throws. */
export function externalAudioIsActive(): boolean {
  const arch = process.arch === 'x64' ? 'x64' : 'arm64';
  const candidates = [
    join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'native', `focusreels-audio-activity-${arch}`),
    join(__dirname, '..', 'native', `focusreels-audio-activity-${arch}`),
  ];
  const helper = candidates.find((path) => existsSync(path));
  if (!helper) return false;
  try {
    const result = JSON.parse(execFileSync(helper, [], { timeout: 500, encoding: 'utf8' })) as { runningSomewhere?: unknown };
    return result.runningSomewhere === true;
  } catch {
    return false;
  }
}
