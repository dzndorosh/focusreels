/**
 * Safety net for the case no hook can cover: the IDE died mid-turn and will
 * never send `turn_ended`. The watchdog would eventually catch it, but minutes
 * later — this closes the turn within one poll.
 *
 * It reads process names only (`ps -Ao comm=`), never window titles or args.
 */

import { execFile } from 'node:child_process';
import type { SourceId } from '../core/events.js';

/**
 * Only sources whose host process can be named unambiguously appear here.
 * `claude-code` deliberately does not: the CLI runs inside whatever terminal or
 * GUI shell you happen to use (Terminal, iTerm, Orca, …), so there is no single
 * process whose absence means "the agent is gone". Those turns are covered by
 * the Stop hook and, failing that, by the watchdog.
 */
const PROCESS_HINTS: Partial<Record<SourceId, RegExp>> = {
  cursor: /\/Cursor\.app\//i,
  'vscode-copilot': /\/(Visual Studio Code|VSCodium|Code - Insiders)\.app\//i,
  jetbrains: /\/(IntelliJ IDEA[^/]*|WebStorm|PyCharm[^/]*|GoLand|CLion|Rider|PhpStorm|RubyMine|DataGrip|Android Studio|Fleet)\.app\//i,
};

export type OnIdeGone = (source: SourceId) => void;

export class IdeWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sourcesInFlight: () => SourceId[],
    private readonly onGone: OnIdeGone,
    private readonly intervalMs = 5000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const pending = [...new Set(this.sourcesInFlight())].filter((s) => PROCESS_HINTS[s]);
    if (pending.length === 0) return;

    const table = await this.processTable();
    if (table === null) return; // ps unavailable: never guess an IDE is gone

    for (const source of pending) {
      const hint = PROCESS_HINTS[source];
      if (hint && !hint.test(table)) this.onGone(source);
    }
  }

  private processTable(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile('/bin/ps', ['-Ao', 'comm='], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        resolve(err ? null : stdout);
      });
    });
  }
}
