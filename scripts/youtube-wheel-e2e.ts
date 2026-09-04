import { connect } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const profile = process.env.FOCUSREELS_E2E_USER_DATA;
if (!profile || !profile.startsWith('/') || profile.includes('..')) throw new Error('Set FOCUSREELS_E2E_USER_DATA to an absolute path');
const socketPath = join(profile, 'feed-e2e.sock');
const tracePath = join(profile, 'feed-trace.jsonl');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Event = { event: string; videoId?: string; direction?: string; sequence?: number; timestamp?: string };
function trace(): Event[] { try { return readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; } }
async function command(action: string, extra: Record<string, unknown> = {}) {
  await new Promise<void>((resolve, reject) => {
    const socket = connect(socketPath, () => { socket.write(JSON.stringify({ action, ...extra }) + '\n'); if (!['status', 'trace'].includes(action)) socket.end(); });
    socket.on('data', () => {}); socket.on('close', () => resolve()); socket.on('error', reject);
  });
}
async function waitFor(predicate: (events: Event[]) => boolean, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const events = trace(); if (predicate(events)) return events; await sleep(100); }
  throw new Error('Timed out waiting for feed trace event');
}
function after(events: Event[], sequence: number, predicate: (event: Event) => boolean) { return events.some((event) => (event.sequence ?? 0) > sequence && predicate(event)); }
function sequenceOf(events: Event[], predicate: (event: Event) => boolean) { return events.find((event) => predicate(event))?.sequence ?? Number.MAX_SAFE_INTEGER; }
async function flick(values: number[]) { for (const deltaY of values) { await command('wheel', { deltaY }); await sleep(18); } }
async function main() {
  if (!existsSync(socketPath)) throw new Error(`E2E socket not found: ${socketPath}`);
  await sleep(3500); await command('hold-open', { enabled: true }); await command('show');
  let events = await waitFor((xs) => xs.some((e) => e.event === 'player-playing'));
  const selected = events.filter((e) => e.event === 'video-selected' && e.videoId).map((e) => e.videoId!);
  const a = selected[0]; if (!a) throw new Error('Initial video was not selected');
  await waitFor((xs) => xs.some((e) => e.event === 'player-playing' && e.videoId === a));

  let baseline = trace().reduce((n, e) => Math.max(n, e.sequence ?? 0), 0);
  await flick([-42, -36, -30, -22]);
  const transitionBaseline = baseline;
  // Keep the stream alive beyond the 320ms slide so its momentum is observed
  // while navigation is locked, not as a later independent gesture.
  await flick(Array.from({ length: 24 }, () => -18));
  events = await waitFor((xs) => after(xs, transitionBaseline, (e) => e.event === 'transition-complete' && e.direction === 'next'));
  const b = events.filter((e) => (e.sequence ?? 0) > baseline && e.event === 'transition-complete' && e.direction === 'next').at(-1)?.videoId;
  if (!b) throw new Error('Forward transition did not complete');
  const incomingReady = sequenceOf(events, (e) => e.event === 'incoming-playback-ready' && e.videoId === b);
  const frameStable = sequenceOf(events, (e) => e.event === 'incoming-frame-stable' && e.videoId === b);
  const transitionStart = sequenceOf(events, (e) => e.event === 'transition-start' && e.videoId === b);
  if (!(incomingReady < frameStable && frameStable < transitionStart)) throw new Error('Incoming playback/frame was not stable before transition');
  const commitEvent = events.find((e) => (e.sequence ?? 0) > baseline && e.event === 'gesture-commit');
  const startEvent = events.find((e) => e.event === 'transition-start' && e.videoId === b);
  if (commitEvent?.timestamp && startEvent?.timestamp && Date.parse(startEvent.timestamp) - Date.parse(commitEvent.timestamp) > 150) throw new Error('Primed transition exceeded fast-path latency');
  const transitionComplete = sequenceOf(events, (e) => e.event === 'transition-complete' && e.videoId === b);
  if (events.some((e) => (e.sequence ?? 0) > transitionComplete && e.event === 'play-command' && e.videoId === b)) throw new Error('Incoming player was played again after transition');
  await waitFor((xs) => xs.some((e) => e.event === 'player-playing' && e.videoId === b));
  const selectionsAfterB = trace().filter((e) => e.event === 'video-selected').length;
  await sleep(START_TIMEOUT_MS + 1000);
  const afterWatchdog = trace().filter((e) => e.event === 'video-selected');
  if (afterWatchdog.length !== selectionsAfterB || afterWatchdog.at(-1)?.videoId !== b) throw new Error('watchdog advanced an already-playing promoted front');
  await sleep(260);
  events = trace();
  const firstStreamSelections = events.filter((e) => (e.sequence ?? 0) > transitionBaseline && e.event === 'video-selected');
  if (firstStreamSelections.length !== 1 || firstStreamSelections[0].videoId !== b) throw new Error(`Momentum stream selected ${firstStreamSelections.length} videos`);

  baseline = events.reduce((n, e) => Math.max(n, e.sequence ?? 0), 0);
  await flick([-48, -44, -40]);
  events = await waitFor((xs) => after(xs, baseline, (e) => e.event === 'transition-complete' && e.direction === 'next'));
  const c = events.filter((e) => (e.sequence ?? 0) > baseline && e.event === 'transition-complete' && e.direction === 'next').at(-1)?.videoId;
  if (!c || c === b) throw new Error('Second forward transition did not select a new video');
  await waitFor((xs) => xs.some((e) => e.event === 'player-playing' && e.videoId === c));

  baseline = trace().reduce((n, e) => Math.max(n, e.sequence ?? 0), 0);
  // Electron's mouseWheel delta sign is opposite to the DOM wheel direction.
  await flick([55, 45, 35]);
  events = await waitFor((xs) => after(xs, baseline, (e) => e.event === 'transition-complete' && e.direction === 'previous' && e.videoId === b));
  await waitFor((xs) => xs.some((e) => (e.sequence ?? 0) > baseline && e.event === 'player-playing' && e.videoId === b));
  console.log(JSON.stringify({ initial: a, forward: b, secondForward: c, previous: b, streamSelections: firstStreamSelections.length }, null, 2));
  await command('hold-open', { enabled: false }); await command('hide');
}
const START_TIMEOUT_MS = 6000;
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
