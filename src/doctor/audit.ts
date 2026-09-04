/**
 * Reads the hook entries this app has written into other tools' config files
 * and says whether they could possibly work.
 *
 * This exists because of a real failure that went unnoticed for a long time:
 * the installer wrote a hook command pointing at a path that no longer existed,
 * printed "Installed", and left. The agent then printed a hook error on every
 * prompt, into an interface this app cannot see, while the menu bar showed a
 * confident tick. Nothing in the product could tell the difference between
 * "installed and idle" and "installed and broken".
 *
 * Parsing is separated from the filesystem so the rules are testable: these
 * functions take already-parsed JSON and return what they found.
 */

/** The marker every command this app writes contains. */
export const HOOK_MARKER = 'focusreels';

export interface HookRef {
  /** the tool whose config this came from */
  target: string;
  /** the config's own event name, e.g. `UserPromptSubmit` */
  event: string;
  /** the command as written in the config */
  command: string;
  /**
   * The script the command runs, unquoted — the thing that has to exist.
   * `null` when the command is shaped in a way we cannot read, which is itself
   * worth reporting rather than passing silently.
   */
  scriptPath: string | null;
}

/**
 * Commands are written as `/bin/sh '<path>' <kind>`, but a hand-edited config
 * may hold anything, so this reads the first `.sh` token rather than assuming
 * a position. `$HOME` and `${userHome}` are expanded because a template that
 * has not been through the installer still names a real file.
 */
export function scriptPathOf(command: string, home: string): string | null {
  const expanded = command
    .replaceAll('${userHome}', home)
    .replaceAll('${HOME}', home)
    .replaceAll('$HOME', home);

  // Quoted first: a path with a space is only unambiguous inside quotes.
  const quoted = expanded.match(/['"]([^'"]*\.sh)['"]/);
  if (quoted?.[1]) return quoted[1];

  const bare = expanded.match(/(\S*\.sh)/);
  return bare?.[1] ?? null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `settings.hooks[event][].hooks[].command` — the Claude Code shape. */
export function claudeHookRefs(settings: unknown, home: string): HookRef[] {
  const refs: HookRef[] = [];
  if (!isRecord(settings) || !isRecord(settings.hooks)) return refs;

  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const inner = isRecord(group) && Array.isArray(group.hooks) ? group.hooks : [];
      for (const hook of inner) {
        if (!isRecord(hook) || typeof hook.command !== 'string') continue;
        if (!hook.command.includes(HOOK_MARKER)) continue;
        refs.push({
          target: 'claude-code',
          event,
          command: hook.command,
          scriptPath: scriptPathOf(hook.command, home),
        });
      }
    }
  }
  return refs;
}

/** `hooks[event][].command` — the shape Cursor and the VS Code template use. */
export function flatHookRefs(config: unknown, target: string, home: string): HookRef[] {
  const refs: HookRef[] = [];
  if (!isRecord(config) || !isRecord(config.hooks)) return refs;

  for (const [event, entries] of Object.entries(config.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.command !== 'string') continue;
      if (!entry.command.includes(HOOK_MARKER)) continue;
      refs.push({
        target,
        event,
        command: entry.command,
        scriptPath: scriptPathOf(entry.command, home),
      });
    }
  }
  return refs;
}

export type ProblemKind = 'missing_script' | 'unreadable_command';

export interface Problem {
  kind: ProblemKind;
  ref: HookRef;
}

/**
 * The only question that matters here: can this command run at all? A hook
 * whose script is gone fails on every single turn, and the failure is invisible
 * from inside this app.
 */
export function auditRefs(refs: HookRef[], exists: (path: string) => boolean): Problem[] {
  const problems: Problem[] = [];
  for (const ref of refs) {
    if (ref.scriptPath === null) problems.push({ kind: 'unreadable_command', ref });
    else if (!exists(ref.scriptPath)) problems.push({ kind: 'missing_script', ref });
  }
  return problems;
}

/** One line per problem, in the imperative — a report nobody has to decode. */
export function describeProblem(problem: Problem): string {
  const { ref } = problem;
  if (problem.kind === 'unreadable_command') {
    return `${ref.target} · ${ref.event}: cannot tell which script this runs — ${ref.command}`;
  }
  return `${ref.target} · ${ref.event}: runs a script that does not exist — ${ref.scriptPath}`;
}
