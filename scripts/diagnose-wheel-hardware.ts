/**
 * Human-in-the-loop capture for a physical macOS trackpad wheel stream.
 * It deliberately does not synthesize any input: move the pointer over the
 * visible video and perform the two requested gestures yourself.
 */
import { mkdtempSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { connect } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const profile = mkdtempSync(join(tmpdir(), 'focusreels-wheel-hardware-'));
const socketPath = join(profile, 'feed-e2e.sock');
const capturePath = join(profile, 'wheel-hardware.jsonl');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = join(root, 'artifacts', 'wheel-hardware', stamp);
const fixturePath = join(artifactDir, 'strong-flick.fixture.json');
const normalFixturePath = join(artifactDir, 'normal-flick.fixture.json');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type CapturedWheel = {
  marker?: string | null;
  timestamp: number;
  gapMs?: number | null;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
};

async function command(action: string, extra: Record<string, unknown> = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect(socketPath, () => socket.write(JSON.stringify({ action, ...extra }) + '\n'));
    socket.on('close', resolve);
    socket.on('error', reject);
  });
}

async function waitForSocket(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for Electron's E2E socket at ${socketPath}. Electron may have failed to start; inspect the startup output above, then retry.`);
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  JSON.parse(readFileSync(temp, 'utf8'));
  renameSync(temp, path);
}

function readCapture(): CapturedWheel[] {
  if (!existsSync(capturePath)) return [];
  return readFileSync(capturePath, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as CapturedWheel]; } catch { return []; }
  });
}

function sanitizeFixture(events: CapturedWheel[]) {
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    // Deliberately contains timing and wheel deltas only: no video IDs,
    // profile paths, URLs, or user data are retained.
    events: events.map((event) => ({
      gapMs: Number.isFinite(event.gapMs) ? event.gapMs : 0,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
    })),
  };
}

async function main(): Promise<void> {
  console.log(`[wheel-diagnose] Creating isolated profile: ${profile}`);
  console.log('[wheel-diagnose] Starting Electron for physical wheel capture…');
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['start'], {
    cwd: root,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      FOCUSREELS_E2E: '1',
      FOCUSREELS_E2E_USER_DATA: profile,
      FOCUSREELS_WHEEL_HARDWARE_CAPTURE: '1',
      FOCUSREELS_DEBUG_FEED: '1',
    },
  });
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let interrupted = false;
  const stopChild = () => {
    if (child.exitCode !== null || child.killed) return;
    if (process.platform !== 'win32' && child.pid) {
      try { process.kill(-child.pid, 'SIGINT'); return; } catch { /* fall through */ }
    }
    child.kill('SIGINT');
  };
  const onInterrupt = () => {
    interrupted = true;
    console.log('\n[wheel-diagnose] Interrupted; closing Electron and preserving any captured files.');
    readline.close();
    stopChild();
  };
  process.once('SIGINT', onInterrupt);
  try {
    console.log('[wheel-diagnose] Waiting up to 30 seconds for the E2E socket…');
    await waitForSocket();
    await command('hold-open', { enabled: true });
    await command('show');
    await sleep(1_000);

    await command('wheel-capture-marker', { marker: 'normal-flick' });
    await readline.question('\nMove the pointer over the FocusReels video. Perform ONE ordinary physical trackpad flick, wait for it to settle, then press Enter.\n');
    if (interrupted) return;
    await sleep(350);

    await command('wheel-capture-marker', { marker: 'strong-flick' });
    await readline.question('\nPerform ONE strong physical trackpad flick that visually causes the double transition, wait for it to settle, then press Enter.\n');
    if (interrupted) return;
    await sleep(350);

    const capture = readCapture();
    const normal = capture.filter((event) => event.marker === 'normal-flick');
    const strong = capture.filter((event) => event.marker === 'strong-flick');
    if (strong.length === 0) throw new Error('No strong-flick wheel events were captured. Ensure the pointer is over the video layer and retry.');
    mkdirSync(artifactDir, { recursive: true });
    writeJsonAtomic(fixturePath, sanitizeFixture(strong));
    if (normal.length > 0) writeJsonAtomic(normalFixturePath, sanitizeFixture(normal));
    console.log(`\nCaptured ${capture.length} wheel events (${strong.length} strong-flick).`);
    console.log(`Sanitized fixture: ${fixturePath}`);
    const replay = spawnSync('npx', ['vitest', 'run', 'tests/wheelHardwareReplay.test.ts'], {
      cwd: root,
      env: {
        ...process.env,
        FOCUSREELS_WHEEL_FIXTURE: fixturePath,
        FOCUSREELS_WHEEL_RUNTIME_CAPTURE: capturePath,
      },
      stdio: 'inherit',
    });
    console.log(`Hardware replay exit code: ${replay.status ?? 1} (a red result is expected if this fixture reproduces the double transition).`);
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    readline.close();
    try { await command('hold-open', { enabled: false }); await command('hide'); } catch { /* app may have failed while starting */ }
    stopChild();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
