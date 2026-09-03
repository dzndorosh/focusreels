#!/usr/bin/env node
/**
 * focusreels demo — drive the app with synthetic turns, no IDE required.
 *
 *   node dist/cli/demo.js                 # endless mixed traffic
 *   node dist/cli/demo.js --scenario long # one slow turn
 *   node dist/cli/demo.js --scenario fast # a sub-500ms turn (must NOT show)
 *   node dist/cli/demo.js --scenario parallel
 *   node dist/cli/demo.js --scenario abort|error|stuck
 */

import { sendEvent } from '../broker/server.js';
import type { Outcome, SourceId } from '../core/events.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min));

let seq = 0;
const nextId = () => `demo-${Date.now().toString(36)}-${(seq += 1)}`;

async function start(source: SourceId, id: string): Promise<void> {
  await sendEvent({ source, turn_id: id, event: 'turn_started', timestamp: Date.now() });
  log(`▶ ${source} ${id} started`);
}

async function progress(source: SourceId, id: string): Promise<void> {
  await sendEvent({ source, turn_id: id, event: 'turn_progress', timestamp: Date.now() });
  log(`· ${source} ${id} first response`);
}

async function end(source: SourceId, id: string, outcome: Outcome): Promise<void> {
  await sendEvent({ source, turn_id: id, event: 'turn_ended', outcome, timestamp: Date.now() });
  log(`■ ${source} ${id} ${outcome}`);
}

function log(line: string): void {
  process.stdout.write(`${new Date().toLocaleTimeString()}  ${line}\n`);
}

async function turn(source: SourceId, durationMs: number, outcome: Outcome): Promise<void> {
  const id = nextId();
  await start(source, id);
  if (durationMs > 1200) {
    await sleep(Math.floor(durationMs * 0.6));
    await progress(source, id);
    await sleep(durationMs - Math.floor(durationMs * 0.6));
  } else {
    await sleep(durationMs);
  }
  await end(source, id, outcome);
}

async function scenario(name: string): Promise<void> {
  switch (name) {
    case 'fast':
      log('a turn answered in 250ms — the overlay must stay hidden');
      await turn('demo', 250, 'completed');
      return;
    case 'long':
      await turn('demo', 8000, 'completed');
      return;
    case 'abort':
      await turn('demo', 3000, 'aborted');
      return;
    case 'error':
      await turn('demo', 2500, 'error');
      return;
    case 'stuck': {
      log('a turn that never ends — only the watchdog can close it');
      await start('demo', nextId());
      return;
    }
    case 'parallel': {
      const a = nextId();
      const b = nextId();
      await start('cursor', a);
      await sleep(700);
      await start('jetbrains', b);
      await sleep(2500);
      await end('cursor', a, 'completed');
      log('one turn ended, the other is still running — the overlay must stay up');
      await sleep(3000);
      await end('jetbrains', b, 'completed');
      return;
    }
    default:
      throw new Error(`unknown scenario: ${name}`);
  }
}

async function loop(): Promise<void> {
  const sources: SourceId[] = ['demo', 'cursor', 'vscode-copilot', 'jetbrains'];
  const outcomes: Outcome[] = ['completed', 'completed', 'completed', 'aborted', 'error'];
  log('mixed traffic — Ctrl+C to stop');
  for (;;) {
    const source = sources[rand(0, sources.length)]!;
    const outcome = outcomes[rand(0, outcomes.length)]!;
    // one in four turns is deliberately fast enough to stay invisible
    const duration = Math.random() < 0.25 ? rand(120, 480) : rand(1500, 9000);
    await turn(source, duration, outcome);
    await sleep(rand(1500, 5000));
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--scenario');
  const name = idx >= 0 ? argv[idx + 1] : undefined;

  const reachable = await sendEvent({
    source: 'demo',
    turn_id: 'ping',
    event: 'turn_ended',
    outcome: 'completed',
    timestamp: Date.now(),
  });
  if (!reachable) {
    process.stderr.write('FocusReels is not running. Start it with `npm start`.\n');
    process.exitCode = 1;
    return;
  }

  if (name) await scenario(name);
  else await loop();
}

main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
});
