#!/usr/bin/env node
/**
 * focusreels-emit — the only thing an IDE hook ever runs.
 *
 * Contract with the IDE: be fast, be quiet, and never fail. If FocusReels is
 * not running, or anything at all goes wrong, this exits 0 so the agent turn
 * is never disturbed.
 *
 * It reads the hook's stdin JSON only to pull an opaque id / status field out
 * of it (--id-from-stdin / --outcome-from-stdin). Nothing else from stdin is
 * read, kept, or forwarded.
 */

import { sendEvent } from '../broker/server.js';
import { EVENT_NAMES, OUTCOMES, SOURCES, type Outcome } from '../core/events.js';

interface Args {
  [key: string]: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[a.slice(2)] = next;
        i += 1;
      } else {
        out[a.slice(2)] = 'true';
      }
    }
  }
  return out;
}

function readStdin(timeoutMs = 300): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    const done = () => resolve(data);
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) {
        clearTimeout(timer);
        done();
      }
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      done();
    });
  });
}

/** Reduce anything an IDE hands us to an id we are willing to store. */
function toOpaqueId(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 128);
  return cleaned.length > 0 ? cleaned : null;
}

const OUTCOME_ALIASES: Record<string, Outcome> = {
  completed: 'completed',
  complete: 'completed',
  success: 'completed',
  ok: 'completed',
  finished: 'completed',
  aborted: 'aborted',
  abort: 'aborted',
  cancelled: 'aborted',
  canceled: 'aborted',
  interrupted: 'aborted',
  stopped: 'aborted',
  error: 'error',
  failed: 'error',
  failure: 'error',
};

const USAGE = `focusreels-emit --source <${SOURCES.join('|')}> --event <${EVENT_NAMES.join('|')}> --turn-id <id>
                 [--outcome <${OUTCOMES.join('|')}>]
                 [--id-from-stdin <jsonField>] [--outcome-from-stdin <jsonField>]
                 [--socket <path>]`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === 'true' || args.h === 'true') {
    process.stdout.write(USAGE + '\n');
    return;
  }

  const source = args.source;
  const event = args.event;
  if (!source || !event) {
    process.stderr.write(USAGE + '\n');
    return; // still exit 0 — a broken hook config must not break the IDE
  }

  let turnId = args['turn-id'] ? toOpaqueId(args['turn-id']) : null;
  let outcome = args.outcome ?? null;

  const needsStdin = Boolean(args['id-from-stdin'] || args['outcome-from-stdin']);
  if (needsStdin) {
    const raw = await readStdin();
    let payload: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      /* a hook that speaks something other than JSON just gets defaults */
    }
    if (!turnId && args['id-from-stdin']) {
      for (const field of args['id-from-stdin']!.split(',')) {
        const candidate = toOpaqueId(payload[field.trim()]);
        if (candidate) {
          turnId = candidate;
          break;
        }
      }
    }
    if (!outcome && args['outcome-from-stdin']) {
      const raw2 = payload[args['outcome-from-stdin']!];
      if (typeof raw2 === 'string') outcome = OUTCOME_ALIASES[raw2.toLowerCase()] ?? null;
    }
  }

  // No usable id? Fall back to a per-IDE singleton lane. Better one shared
  // lane than a dropped event that strands the overlay on screen.
  if (!turnId) turnId = 'default';

  await sendEvent({
    source,
    turn_id: turnId,
    event,
    outcome: event === 'turn_ended' ? (outcome ?? 'completed') : null,
    timestamp: Date.now(),
  }, args.socket);
}

main().catch(() => {
  /* never surface a failure to the IDE */
});
