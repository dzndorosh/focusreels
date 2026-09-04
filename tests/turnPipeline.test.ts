/**
 * The whole mechanic, end to end: a real shell hook writes to a real socket,
 * the broker parses it, the registry decides whether the overlay is up.
 *
 * This is the one test that would catch the product being useless. Everything
 * else checks a layer; this checks the claim — video while the agent thinks,
 * and only while it thinks.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBroker } from '../src/broker/server.js';
import { DEFAULT_REGISTRY_CONFIG, TurnRegistry } from '../src/core/turnRegistry.js';
import { FakeTimers } from './fakeTimers.js';

const root = process.cwd();
const CLAUDE_HOOK = 'adapters/claude-code/focusreels-claude-hook.sh';
const PAYLOAD = '{"session_id":"claude:7","prompt":"never forwarded"}';

describe('overlay visibility, driven by the real adapter hooks', () => {
  let dir: string;
  let socketPath: string;
  let broker: EventBroker;
  let registry: TurnRegistry;
  let timers: FakeTimers;
  let delivered: number;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'focusreels-pipeline-'));
    socketPath = join(dir, 'broker.sock');
    timers = new FakeTimers();
    delivered = 0;
    registry = new TurnRegistry({ timers, getConfig: () => DEFAULT_REGISTRY_CONFIG });
    broker = new EventBroker({
      path: socketPath,
      onEvent: (e) => {
        delivered += 1;
        registry.dispatch(e);
      },
      onRejected: () => {},
    });
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Runs a hook and waits for the broker to have finished with its event. */
  const hook = async (kind: string, script = CLAUDE_HOOK): Promise<void> => {
    const before = delivered;
    const child = spawn('/bin/sh', [join(root, script), kind], {
      env: { ...process.env, FOCUSREELS_SOCKET: socketPath, FOCUSREELS_SUPPORT_DIR: dir },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.stdin.on('error', () => {});
    child.stdin.end(PAYLOAD);
    await new Promise((resolve) => child.once('close', resolve));
    // The socket write and the dispatch are not the same tick.
    for (let i = 0; i < 200 && delivered === before; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  it('plays while the agent thinks, and stops the moment it asks a question', async () => {
    await hook('started');
    timers.advance(500);
    expect(registry.visible).toBe(true);

    // Working: a tool ran.
    await hook('progress');
    timers.advance(60_000);
    expect(registry.visible).toBe(true);

    // Parked on a permission prompt — the human has to read something now.
    await hook('paused');
    expect(registry.visible).toBe(false);

    // Answered; the agent is thinking again.
    await hook('progress');
    timers.advance(500);
    expect(registry.visible).toBe(true);

    await hook('ended');
    expect(registry.visible).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('does not leave video on screen when the close event never arrives', async () => {
    await hook('started');
    timers.advance(500);
    expect(registry.visible).toBe(true);

    // The agent was interrupted: no Stop, no SessionEnd, nothing.
    timers.advance(DEFAULT_REGISTRY_CONFIG.idleWatchdogMs);
    expect(registry.visible).toBe(false);
  });
});
