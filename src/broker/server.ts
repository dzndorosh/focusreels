/**
 * Local event broker: newline-delimited JSON over a Unix domain socket.
 *
 * Every line is pushed through `sanitizeEvent` before it reaches the registry,
 * so a misbehaving adapter cannot get content past this file. Malformed lines
 * are counted and dropped — never logged verbatim, since the offending line is
 * exactly the thing that might contain a prompt.
 */

import { chmod, mkdir, stat, unlink } from 'node:fs/promises';
import net from 'node:net';
import { dirname } from 'node:path';
import { sanitizeEvent, type TurnEvent } from '../core/events.js';
import { socketPath } from './paths.js';

const MAX_LINE_BYTES = 8 * 1024;

export interface BrokerStats {
  accepted: number;
  rejected: number;
  connections: number;
}

export interface BrokerOptions {
  path?: string;
  onEvent: (event: TurnEvent) => void;
  onRejected?: (reason: string) => void;
}

export class EventBroker {
  private server: net.Server | null = null;
  /** Keep client sockets so shutdown never waits for a chatty or stuck adapter. */
  private readonly sockets = new Set<net.Socket>();
  private readonly path: string;
  readonly stats: BrokerStats = { accepted: 0, rejected: 0, connections: 0 };

  constructor(private readonly opts: BrokerOptions) {
    this.path = opts.path ?? socketPath();
  }

  get address(): string {
    return this.path;
  }

  async start(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await this.clearStaleSocket();

    this.server = net.createServer((socket) => this.handle(socket));
    this.server.on('error', (err) => {
      // A broker that cannot listen is a broken app, but never a crashed IDE.
      console.error('[broker] listen error:', (err as Error).message);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.path, () => resolve());
    });

    await chmod(this.path, 0o600);
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
    await unlink(this.path).catch(() => {});
  }

  /** A socket file left by a crash would block listen(); a live one must not be removed. */
  private async clearStaleSocket(): Promise<void> {
    try {
      await stat(this.path);
    } catch {
      return; // nothing there
    }
    const alive = await this.ping();
    if (alive) throw new Error(`FocusReels is already running (socket ${this.path})`);
    await unlink(this.path).catch(() => {});
  }

  private ping(): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = net.connect(this.path);
      const done = (v: boolean) => {
        probe.destroy();
        resolve(v);
      };
      probe.once('connect', () => done(true));
      probe.once('error', () => done(false));
      setTimeout(() => done(false), 250).unref?.();
    });
  }

  private handle(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    this.stats.connections += 1;
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE_BYTES) {
        // Oversized input is by definition not a five-field metadata event.
        this.reject('line too long');
        buffer = '';
        socket.destroy();
        return;
      }
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        this.consume(line);
      }
    });

    socket.on('error', () => socket.destroy());
    socket.on('end', () => {
      if (buffer.trim().length > 0) this.consume(buffer);
    });
  }

  private consume(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.reject('not JSON');
      return;
    }
    try {
      const event = sanitizeEvent(parsed);
      this.stats.accepted += 1;
      this.opts.onEvent(event);
    } catch (err) {
      this.reject((err as Error).message);
    }
  }

  private reject(reason: string): void {
    this.stats.rejected += 1;
    this.opts.onRejected?.(reason);
  }
}

/** Fire-and-forget client used by the emit CLI and the demo generator. */
export function sendEvent(event: unknown, path: string = socketPath()): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(path);
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('error', () => finish(false)); // app not running: stay silent
    socket.once('connect', () => {
      socket.write(JSON.stringify(event) + '\n', () => finish(true));
    });
    setTimeout(() => finish(false), 500).unref?.();
  });
}
