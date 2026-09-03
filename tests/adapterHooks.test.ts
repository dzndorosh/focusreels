import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const root = process.cwd();

interface HookResult {
  event: Record<string, unknown>;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function runHook(script: string, argument: string, payload: string): Promise<HookResult> {
  const directory = mkdtempSync(join(tmpdir(), 'focusreels-hook-'));
  temporaryDirectories.push(directory);
  const socketPath = join(directory, 'broker.sock');
  let received = '';

  let resolveEvent: (event: Record<string, unknown>) => void;
  let rejectEvent: (error: Error) => void;
  const event = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveEvent = resolve;
    rejectEvent = reject;
  });
  const timer = setTimeout(() => rejectEvent(new Error('hook did not send an event')), 1_000);
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { received += chunk; });
    socket.on('end', () => {
      clearTimeout(timer);
      try {
        resolveEvent(JSON.parse(received.trim()) as Record<string, unknown>);
      } catch (error) {
        rejectEvent(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
  server.listen(socketPath);
  await once(server, 'listening');

  const child = spawn('/bin/sh', [join(root, script), argument], {
    env: { ...process.env, FOCUSREELS_SOCKET: socketPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.end(payload);

  const [receivedEvent, exitCode] = await Promise.all([
    event,
    new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }),
  ]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return { event: receivedEvent, stdout, stderr, exitCode };
}

describe('macOS adapter hooks', () => {
  it('does not depend on Node or a source checkout', () => {
    for (const script of [
      'adapters/cursor/focusreels-cursor-hook.sh',
      'adapters/vscode-copilot/focusreels-copilot-hook.sh',
      'adapters/claude-code/focusreels-claude-hook.sh',
      'adapters/shared/focusreels-hook.sh',
    ]) {
      const source = readFileSync(join(root, script), 'utf8');
      expect(source).not.toMatch(/FOCUSREELS_(HOME|NODE)|dist\/cli\/emit|command -v node/);
    }
  });

  it('sends a sanitized Cursor start event without Node or checkout paths', async () => {
    const result = await runHook(
      'adapters/cursor/focusreels-cursor-hook.sh',
      'started',
      '{"generationId":"cursor/turn 1"}',
    );

    expect(result).toMatchObject({
      event: { source: 'cursor', turn_id: 'cursorturn1', event: 'turn_started' },
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
  });

  it('maps a VS Code cancellation to an aborted turn', async () => {
    const result = await runHook(
      'adapters/vscode-copilot/focusreels-copilot-hook.sh',
      'ended',
      '{"sessionId":"vscode-42","status":"cancelled"}',
    );

    expect(result.event).toEqual({
      source: 'vscode-copilot',
      turn_id: 'vscode-42',
      event: 'turn_ended',
      outcome: 'aborted',
    });
  });

  it('maps Claude Code completion and failure without reading prompt content', async () => {
    const payload = '{"session_id":"claude:7","prompt":"do not forward this"}';
    const completed = await runHook('adapters/claude-code/focusreels-claude-hook.sh', 'ended', payload);
    const failed = await runHook('adapters/claude-code/focusreels-claude-hook.sh', 'error', payload);

    expect(completed.event).toEqual({
      source: 'claude-code', turn_id: 'claude:7', event: 'turn_ended', outcome: 'completed',
    });
    expect(failed.event).toEqual({
      source: 'claude-code', turn_id: 'claude:7', event: 'turn_ended', outcome: 'error',
    });
    expect(JSON.stringify(completed.event)).not.toContain('prompt');
  });

  it('uses the safe default lane when no candidate ID exists', async () => {
    const result = await runHook('adapters/cursor/focusreels-cursor-hook.sh', 'started', '{}');
    expect(result.event).toMatchObject({ source: 'cursor', turn_id: 'default', event: 'turn_started' });
  });
});
