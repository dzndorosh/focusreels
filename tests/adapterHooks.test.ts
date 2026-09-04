import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const root = process.cwd();
const CLAUDE_HOOK_PATH = 'adapters/claude-code/focusreels-claude-hook.sh';

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
    env: { ...process.env, FOCUSREELS_SOCKET: socketPath, FOCUSREELS_SUPPORT_DIR: directory },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.on('error', () => {});
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

/**
 * Several hook invocations against one socket and one state directory, which is
 * what a pause/resume actually is: separate processes that have to agree.
 */
async function runHookSequence(
  script: string,
  steps: { argument: string; payload: string; extraArgs?: string[]; trailingArgs?: string[] }[],
): Promise<Record<string, unknown>[]> {
  const directory = mkdtempSync(join(tmpdir(), 'focusreels-hook-'));
  temporaryDirectories.push(directory);
  const socketPath = join(directory, 'broker.sock');
  const events: Record<string, unknown>[] = [];

  const server = createServer((socket) => {
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { received += chunk; });
    socket.on('end', () => {
      const line = received.trim();
      if (line) events.push(JSON.parse(line) as Record<string, unknown>);
    });
  });
  server.listen(socketPath);
  await once(server, 'listening');

  for (const step of steps) {
    const child = spawn(
      '/bin/sh',
      [join(root, script), ...(step.extraArgs ?? []), step.argument, ...(step.trailingArgs ?? [])],
      {
        env: { ...process.env, FOCUSREELS_SOCKET: socketPath, FOCUSREELS_SUPPORT_DIR: directory },
        stdio: ['pipe', 'ignore', 'ignore'],
      },
    );
    child.stdin.on('error', () => {});
    child.stdin.end(step.payload);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    // A hook that fails can block the agent's prompt, so this is non-negotiable.
    expect(code).toBe(0);
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
  return events;
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

  it('parks the turn on a permission prompt and re-opens it once work resumes', async () => {
    const payload = '{"session_id":"claude:7"}';
    const events = await runHookSequence('adapters/claude-code/focusreels-claude-hook.sh', [
      { argument: 'started', payload },
      { argument: 'progress', payload },
      // The agent stops and asks the human: it is no longer thinking.
      { argument: 'paused', payload },
      // The human answered, a tool ran: it is thinking again.
      { argument: 'progress', payload },
      { argument: 'ended', payload },
    ]);

    expect(events.map((e) => [e.event, e.outcome ?? null])).toEqual([
      ['turn_started', null],
      ['turn_progress', null],
      ['turn_ended', 'completed'],
      ['turn_started', null],
      ['turn_progress', null],
      ['turn_ended', 'completed'],
    ]);
    for (const event of events) expect(event.turn_id).toBe('claude:7');
  });

  it('does not re-open a turn on a heartbeat that follows no pause', async () => {
    const payload = '{"session_id":"claude:7"}';
    const events = await runHookSequence('adapters/claude-code/focusreels-claude-hook.sh', [
      { argument: 'started', payload },
      { argument: 'progress', payload },
      { argument: 'progress', payload },
    ]);

    expect(events.map((e) => e.event)).toEqual(['turn_started', 'turn_progress', 'turn_progress']);
  });

  it('does no work at all when the app is not running', async () => {
    // Heartbeats fire on every tool call, so a user with hooks installed and
    // the app closed must not pay for a JSON parse and a socket attempt each
    // time. `paused` is the kind with a side effect — it writes a marker — so
    // an untouched directory is proof the hook left before doing anything,
    // which a stopwatch in a parallel test run could never prove.
    const directory = mkdtempSync(join(tmpdir(), 'focusreels-hook-'));
    temporaryDirectories.push(directory);

    const child = spawn('/bin/sh', [join(root, CLAUDE_HOOK_PATH), 'paused'], {
      env: {
        ...process.env,
        FOCUSREELS_SOCKET: join(directory, 'absent.sock'),
        FOCUSREELS_SUPPORT_DIR: directory,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {});
    child.stdin.end('{"session_id":"claude:7"}');
    const code = await new Promise<number | null>((resolve) => child.once('close', resolve));

    expect(code).toBe(0);
    expect(readdirSync(directory)).toEqual([]);
  });

  it('ignores an unknown kind instead of guessing', async () => {
    const events = await runHookSequence('adapters/claude-code/focusreels-claude-hook.sh', [
      { argument: 'compacted', payload: '{"session_id":"claude:7"}' },
    ]);
    expect(events).toEqual([]);
  });

  it('wires a tool that ships no adapter at all', async () => {
    // The case that started this: an agent the project has never heard of
    // (Codex, Gemini CLI, aider, a script) has to be able to drive the overlay
    // without anyone editing this repo.
    const events = await runHookSequence('adapters/generic/focusreels-emit.sh', [
      { argument: 'started', payload: '', extraArgs: ['codex'] },
      { argument: 'progress', payload: '', extraArgs: ['codex'] },
      { argument: 'ended', payload: '', extraArgs: ['codex'] },
    ]);

    expect(events).toEqual([
      { source: 'codex', turn_id: 'default', event: 'turn_started' },
      { source: 'codex', turn_id: 'default', event: 'turn_progress' },
      { source: 'codex', turn_id: 'default', event: 'turn_ended', outcome: 'completed' },
    ]);
  });

  it('keeps parallel conversations of an unknown tool apart', async () => {
    const events = await runHookSequence('adapters/generic/focusreels-emit.sh', [
      { argument: 'started', payload: '', extraArgs: ['gemini-cli'], trailingArgs: ['chat-a'] },
      { argument: 'started', payload: '', extraArgs: ['gemini-cli'], trailingArgs: ['chat b/../x'] },
    ]);

    expect(events.map((e) => e.turn_id)).toEqual(['chat-a', 'chatb..x']);
  });

  it('refuses a source id the app would reject anyway', async () => {
    const events = await runHookSequence('adapters/generic/focusreels-emit.sh', [
      { argument: 'started', payload: '', extraArgs: ['My Agent'] },
    ]);
    expect(events).toEqual([]);
  });

  it('uses the safe default lane when no candidate ID exists', async () => {
    const result = await runHook('adapters/cursor/focusreels-cursor-hook.sh', 'started', '{}');
    expect(result.event).toMatchObject({ source: 'cursor', turn_id: 'default', event: 'turn_started' });
  });
});
