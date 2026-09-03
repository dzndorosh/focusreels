import { mkdtempSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBroker, sendEvent } from '../src/broker/server.js';
import type { TurnEvent } from '../src/core/events.js';

/** End-to-end over the real socket: what an adapter writes is what lands. */
describe('EventBroker', () => {
  let dir: string;
  let path: string;
  let broker: EventBroker;
  let received: TurnEvent[];
  let rejected: string[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'focusreels-'));
    path = join(dir, 'b.sock');
    received = [];
    rejected = [];
    broker = new EventBroker({
      path,
      onEvent: (e) => received.push(e),
      onRejected: (r) => rejected.push(r),
    });
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (payload: string) =>
    new Promise<void>((resolve) => {
      const s = net.connect(path, () => s.write(payload, () => s.end()));
      s.on('close', () => resolve());
      s.on('error', () => resolve());
    });

  it('accepts a well-formed event', async () => {
    await write(
      JSON.stringify({ source: 'cursor', turn_id: 'a1', event: 'turn_started' }) + '\n',
    );
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ source: 'cursor', turn_id: 'a1' });
  });

  it('strips content an adapter tries to send over the wire', async () => {
    await write(
      JSON.stringify({
        source: 'cursor',
        turn_id: 'a1',
        event: 'turn_started',
        prompt: 'delete the prod database',
        file_path: '/Users/me/app.ts',
      }) + '\n',
    );
    expect(Object.keys(received[0]!).sort()).toEqual([
      'event',
      'outcome',
      'source',
      'timestamp',
      'turn_id',
    ]);
  });

  it('reads several newline-delimited events from one connection', async () => {
    const lines =
      JSON.stringify({ source: 'demo', turn_id: 'x', event: 'turn_started' }) +
      '\n' +
      JSON.stringify({ source: 'demo', turn_id: 'x', event: 'turn_ended', outcome: 'error' }) +
      '\n';
    await write(lines);
    expect(received.map((e) => e.event)).toEqual(['turn_started', 'turn_ended']);
    expect(received[1]!.outcome).toBe('error');
  });

  it('drops junk without crashing', async () => {
    await write('not json\n');
    await write(JSON.stringify({ source: 'ghost', turn_id: 'x', event: 'turn_started' }) + '\n');
    expect(received).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(broker.stats.rejected).toBe(2);
  });

  it('refuses an oversized line instead of buffering it', async () => {
    await write('x'.repeat(9000) + '\n');
    expect(received).toHaveLength(0);
    expect(rejected[0]).toBe('line too long');
  });

  it('sendEvent reports false when nothing is listening', async () => {
    const ok = await sendEvent(
      { source: 'demo', turn_id: 'x', event: 'turn_started' },
      join(dir, 'missing.sock'),
    );
    expect(ok).toBe(false);
  });

  it('refuses to start a second broker on a live socket', async () => {
    const second = new EventBroker({ path, onEvent: () => {} });
    await expect(second.start()).rejects.toThrow(/already running/);
  });

  it('creates a private socket and shuts down idle clients', async () => {
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const client = net.connect(path);
    await new Promise<void>((resolve) => client.once('connect', resolve));
    const closed = new Promise<void>((resolve) => client.once('close', resolve));
    await expect(broker.stop()).resolves.toBeUndefined();
    await closed;
  });
});
