# Open Adapter Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any tool drive FocusReels by writing one line of JSON to the socket, with a declared confidence level, without changing this codebase.

**Architecture:** `source` stops being a closed TypeScript union and becomes a narrowly-shaped open string. A new `SourceRegistry` in `src/core` decides whether a source may open turns — admitting an `exact` source enabled and a `heuristic` source disabled — and holds per-source liveness counters in memory. `settings.json` stores only the policy (`sources`), migrated from the old `enabledSources`.

**Tech Stack:** TypeScript (ESM, `nodenext`), Electron 30 main process, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-04-open-adapter-protocol-design.md`

## Global Constraints

- **Privacy invariant.** `sanitizeEvent` stays the single choke point and keeps rebuilding the event field by field. No task may add a field that can carry prose, a path, or a project name.
- **Source id shape:** `/^[a-z0-9][a-z0-9-]{0,31}$/` — lowercase kebab, 1–32 chars. This exact regex, exported once from `src/core/events.ts`, is the only definition. Never widen it.
- **`turn_id` shape is unchanged:** `/^[A-Za-z0-9._:-]{1,128}$/`.
- **Registered-source cap:** 64.
- **Admission rule:** `confidence: 'exact'` (or absent) → registered `enabled: true`; `confidence: 'heuristic'` → registered `enabled: false`.
- **Confidence is fixed at first registration.** A later event from the same source never changes it.
- **`src/core` stays free of Electron and of I/O.** It is pure and synchronous; timers arrive through the injected `Timers` interface.
- **Run tests with `npx vitest run <file>`** from the `focusreels/` directory. `npm test` runs the whole suite.
- **Commit style:** conventional prefix, imperative mood, e.g. `feat: open the adapter source id`.

---

### Task 1: Open the source id and add `confidence`

**Files:**
- Modify: `src/core/events.ts:10-11` (the `SOURCES` union), `:27-33` (`TurnEvent`), `:53-55` (source validation), `:78-85` (the returned object)
- Test: `tests/events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const SOURCE_ID_RE: RegExp`
  - `export const BUILTIN_SOURCES: readonly ['cursor','vscode-copilot','jetbrains','claude-code','demo']`
  - `export type BuiltinSourceId = (typeof BUILTIN_SOURCES)[number]`
  - `export type SourceId = string`
  - `export const CONFIDENCES: readonly ['exact','heuristic']`
  - `export type Confidence = (typeof CONFIDENCES)[number]`
  - `TurnEvent` gains `confidence: Confidence`, so it now has **six** fields.

- [ ] **Step 1: Write the failing tests**

Append to `tests/events.test.ts`, inside the existing `describe('sanitizeEvent', ...)`:

```ts
  it('accepts a source it has never heard of', () => {
    const e = sanitizeEvent({ ...base, source: 'aider' });
    expect(e.source).toBe('aider');
  });

  it('rejects a source shaped like anything but an id', () => {
    for (const source of ['Aider', 'my agent', '../etc/passwd', '', 'a'.repeat(33), '-lead']) {
      expect(() => sanitizeEvent({ ...base, source })).toThrow(InvalidEventError);
    }
  });

  it('defaults confidence to exact, so today\'s adapters are unchanged', () => {
    expect(sanitizeEvent(base).confidence).toBe('exact');
  });

  it('carries a declared heuristic confidence through', () => {
    expect(sanitizeEvent({ ...base, confidence: 'heuristic' }).confidence).toBe('heuristic');
  });

  it('rejects a confidence it does not know', () => {
    expect(() => sanitizeEvent({ ...base, confidence: 'probably' })).toThrow(InvalidEventError);
  });
```

Then change the existing field-count test — it currently asserts five keys and must now assert six:

```ts
  it('keeps exactly the six metadata fields', () => {
    const e = sanitizeEvent(base);
    expect(Object.keys(e).sort()).toEqual([
      'confidence',
      'event',
      'outcome',
      'source',
      'timestamp',
      'turn_id',
    ]);
  });
```

The existing test named `rejects unknown sources, events and outcomes` still has a case asserting an unknown *source* throws. Open it and delete only that assertion, leaving the event and outcome assertions; rename it to `rejects unknown events and outcomes`. Unknown sources are now the point of the feature.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/events.test.ts`
Expected: FAIL — `aider` throws `unknown source`, and `confidence` is `undefined`.

- [ ] **Step 3: Implement**

In `src/core/events.ts`, replace the `SOURCES` / `SourceId` block:

```ts
/**
 * The sources this app ships adapters for. Used only for labels and defaults —
 * never for validation. Any tool may announce itself with an id of its own.
 */
export const BUILTIN_SOURCES = [
  'cursor',
  'vscode-copilot',
  'jetbrains',
  'claude-code',
  'demo',
] as const;
export type BuiltinSourceId = (typeof BUILTIN_SOURCES)[number];

/** A source id is a machine handle, so it has no room for a path or a sentence. */
export const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export type SourceId = string;

/**
 * How much the adapter actually knows. An `exact` adapter was told by an API;
 * a `heuristic` one inferred the turn from a process tree or a UI, and never
 * opens the window until the user allows that source.
 */
export const CONFIDENCES = ['exact', 'heuristic'] as const;
export type Confidence = (typeof CONFIDENCES)[number];
```

Add `confidence: Confidence;` to `TurnEvent`.

Replace the source check in `sanitizeEvent`:

```ts
  if (typeof r.source !== 'string' || !SOURCE_ID_RE.test(r.source)) {
    throw new InvalidEventError('source must be an id matching [a-z0-9][a-z0-9-]{0,31}');
  }
```

Add the confidence check after the outcome block:

```ts
  let confidence: Confidence = 'exact';
  if (r.confidence !== undefined && r.confidence !== null && r.confidence !== '') {
    if (!isOneOf(CONFIDENCES, r.confidence)) throw new InvalidEventError('unknown confidence');
    confidence = r.confidence;
  }
```

Add `confidence,` to the returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Keep the rest of the tree compiling**

`SOURCES` no longer exists. Run `npm run typecheck` and fix only the import sites, with no behaviour change yet:
- `src/app/settings.ts:8` and `:116` → import `BUILTIN_SOURCES`, loop over it.
- `src/app/tray.ts:9`, `:13`, `:130` → import `BUILTIN_SOURCES` and type `SOURCE_LABELS` as `Record<BuiltinSourceId, string>`.
- `src/cli/emit.ts:15` and `:93` → import `BUILTIN_SOURCES`, use it in the usage string only.
- `src/app/ideWatcher.ts:19` → `const PROCESS_HINTS: Record<string, RegExp> = { … }` and drop the `Partial<Record<SourceId, …>>` wrapper.

Run: `npm run typecheck` — expected: clean. Then `npx vitest run` — expected: whole suite green.

- [ ] **Step 6: Commit**

```bash
git add src/core/events.ts src/app/settings.ts src/app/tray.ts src/app/ideWatcher.ts src/cli/emit.ts tests/events.test.ts
git commit -m "feat: open the adapter source id and add a confidence field"
```

---

### Task 2: `SourceRegistry` — admission, cap, liveness

**Files:**
- Create: `src/core/sourceRegistry.ts`
- Test: `tests/sourceRegistry.test.ts` (create)

**Interfaces:**
- Consumes: `Confidence`, `SourceId`, `TurnEvent`, `SOURCE_ID_RE` from Task 1.
- Produces:
  - `export interface SourcePolicy { enabled: boolean; confidence: Confidence }`
  - `export type BlockReason = 'disabled' | 'cap_reached'`
  - `export interface SourceVerdict { allowed: boolean; reason: BlockReason | null }`
  - `export interface SourceInfo { source: string; enabled: boolean; confidence: Confidence; firstSeenAt: number; lastSeenAt: number; events: number; droppedWhileDisabled: number }`
  - `export const MAX_SOURCES = 64`
  - `export class SourceRegistry { constructor(opts: SourceRegistryOptions); admit(event: TurnEvent): SourceVerdict; list(): SourceInfo[] }`
  - `export interface SourceRegistryOptions { getPolicies: () => Record<string, SourcePolicy>; onRegister: (source: string, policy: SourcePolicy) => void; now?: () => number; max?: number }`

- [ ] **Step 1: Write the failing tests**

Create `tests/sourceRegistry.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeEvent, type TurnEvent } from '../src/core/events.js';
import { SourceRegistry, type SourcePolicy } from '../src/core/sourceRegistry.js';

const ev = (source: string, confidence?: string, event = 'turn_started'): TurnEvent =>
  sanitizeEvent({ source, turn_id: 't1', event, confidence, timestamp: 0 });

describe('SourceRegistry', () => {
  let policies: Record<string, SourcePolicy>;
  let registered: Array<[string, SourcePolicy]>;

  const build = (max?: number) =>
    new SourceRegistry({
      getPolicies: () => policies,
      onRegister: (source, policy) => {
        registered.push([source, policy]);
        policies[source] = policy;
      },
      now: () => 1000,
      max,
    });

  beforeEach(() => {
    policies = {};
    registered = [];
  });

  it('admits an unknown exact source and remembers it enabled', () => {
    const r = build();
    expect(r.admit(ev('aider'))).toEqual({ allowed: true, reason: null });
    expect(registered).toEqual([['aider', { enabled: true, confidence: 'exact' }]]);
  });

  it('registers an unknown heuristic source but blocks it', () => {
    const r = build();
    expect(r.admit(ev('chatgpt-app', 'heuristic'))).toEqual({
      allowed: false,
      reason: 'disabled',
    });
    expect(registered).toEqual([['chatgpt-app', { enabled: false, confidence: 'heuristic' }]]);
  });

  it('honours a policy the user has switched off', () => {
    policies = { cursor: { enabled: false, confidence: 'exact' } };
    expect(build().admit(ev('cursor')).reason).toBe('disabled');
  });

  it('never lets a source upgrade its own confidence', () => {
    const r = build();
    r.admit(ev('sneaky', 'heuristic'));
    r.admit(ev('sneaky', 'exact'));
    expect(policies.sneaky).toEqual({ enabled: false, confidence: 'heuristic' });
    expect(registered).toHaveLength(1);
  });

  it('registers on any event, not only turn_started', () => {
    build().admit(ev('aider', undefined, 'turn_ended'));
    expect(registered).toHaveLength(1);
  });

  it('stops registering past the cap and writes nothing', () => {
    const r = build(2);
    r.admit(ev('one'));
    r.admit(ev('two'));
    expect(r.admit(ev('three'))).toEqual({ allowed: false, reason: 'cap_reached' });
    expect(registered).toHaveLength(2);
    expect(policies.three).toBeUndefined();
  });

  it('counts liveness without touching the policy store', () => {
    const r = build();
    r.admit(ev('aider'));
    r.admit(ev('aider'));
    r.admit(ev('chatgpt-app', 'heuristic'));
    const byId = Object.fromEntries(r.list().map((i) => [i.source, i]));
    expect(byId.aider.events).toBe(2);
    expect(byId.aider.firstSeenAt).toBe(1000);
    expect(byId.aider.lastSeenAt).toBe(1000);
    expect(byId['chatgpt-app'].droppedWhileDisabled).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/sourceRegistry.test.ts`
Expected: FAIL — cannot resolve `../src/core/sourceRegistry.js`.

- [ ] **Step 3: Implement**

Create `src/core/sourceRegistry.ts`:

```ts
/**
 * Decides which sources may open turns, and keeps what we know about the ones
 * we have seen.
 *
 * Two stores, deliberately separate: the *policy* (may this source open turns)
 * is durable and lives in settings.json, written only when a source is first
 * seen or the user toggles it; the *liveness* (counters, last seen) is volatile
 * and lives here, because writing settings on every event would mean a disk
 * write per turn and would fight the hand-editable file.
 */

import type { Confidence, TurnEvent } from './events.js';

export interface SourcePolicy {
  enabled: boolean;
  confidence: Confidence;
}

export type BlockReason = 'disabled' | 'cap_reached';

export interface SourceVerdict {
  allowed: boolean;
  reason: BlockReason | null;
}

export interface SourceInfo {
  source: string;
  enabled: boolean;
  confidence: Confidence;
  firstSeenAt: number;
  lastSeenAt: number;
  events: number;
  droppedWhileDisabled: number;
}

/** An adapter emitting a fresh random id per event must not grow settings.json. */
export const MAX_SOURCES = 64;

export interface SourceRegistryOptions {
  getPolicies: () => Record<string, SourcePolicy>;
  /** persist a newly discovered source; called at most once per source */
  onRegister: (source: string, policy: SourcePolicy) => void;
  now?: () => number;
  max?: number;
}

interface Liveness {
  firstSeenAt: number;
  lastSeenAt: number;
  events: number;
  droppedWhileDisabled: number;
}

export class SourceRegistry {
  private readonly liveness = new Map<string, Liveness>();
  private readonly now: () => number;
  private readonly max: number;
  /** events refused because the cap was already full */
  private _capRejected = 0;

  constructor(private readonly opts: SourceRegistryOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.max = opts.max ?? MAX_SOURCES;
  }

  get capRejected(): number {
    return this._capRejected;
  }

  admit(event: TurnEvent): SourceVerdict {
    const policies = this.opts.getPolicies();
    let policy = policies[event.source];

    if (!policy) {
      if (Object.keys(policies).length >= this.max) {
        this._capRejected += 1;
        return { allowed: false, reason: 'cap_reached' };
      }
      // An adapter that was deliberately installed and claims to know gets to
      // work immediately; a guess waits for the user.
      policy = { enabled: event.confidence === 'exact', confidence: event.confidence };
      this.opts.onRegister(event.source, policy);
    }

    const at = this.now();
    const live = this.liveness.get(event.source) ?? {
      firstSeenAt: at,
      lastSeenAt: at,
      events: 0,
      droppedWhileDisabled: 0,
    };
    live.lastSeenAt = at;
    live.events += 1;
    if (!policy.enabled) live.droppedWhileDisabled += 1;
    this.liveness.set(event.source, live);

    return policy.enabled ? { allowed: true, reason: null } : { allowed: false, reason: 'disabled' };
  }

  /** Everything the menu bar and, later, `doctor` need to show. */
  list(): SourceInfo[] {
    const policies = this.opts.getPolicies();
    const ids = new Set([...Object.keys(policies), ...this.liveness.keys()]);
    return [...ids].sort().map((source) => {
      const policy = policies[source] ?? { enabled: false, confidence: 'exact' as Confidence };
      const live = this.liveness.get(source);
      return {
        source,
        enabled: policy.enabled,
        confidence: policy.confidence,
        firstSeenAt: live?.firstSeenAt ?? 0,
        lastSeenAt: live?.lastSeenAt ?? 0,
        events: live?.events ?? 0,
        droppedWhileDisabled: live?.droppedWhileDisabled ?? 0,
      };
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/sourceRegistry.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/sourceRegistry.ts tests/sourceRegistry.test.ts
git commit -m "feat: add a source registry that admits exact adapters and holds guesses"
```

---

### Task 3: `settings.sources` and migration from `enabledSources`

**Files:**
- Modify: `src/app/settings.ts:22-30` (`Settings`), `:66-73` (defaults), `:112-118` (coercion), `:141` (return)
- Test: `tests/settings.test.ts:52-58` (rewrite that case) and new cases

**Interfaces:**
- Consumes: `SourcePolicy` (Task 2), `BUILTIN_SOURCES`, `SOURCE_ID_RE`, `CONFIDENCES` (Task 1).
- Produces: `Settings.sources: Record<string, SourcePolicy>`. `Settings.enabledSources` is **removed**.

- [ ] **Step 1: Write the failing tests**

In `tests/settings.test.ts`, replace the case at line 52 (`keeps only known sources, and only boolean values`) with:

```ts
  it('migrates an old enabledSources file into sources', () => {
    write({ enabledSources: { cursor: false, jetbrains: true } });
    const s = new SettingsStore(file).get();
    expect(s.sources.cursor).toEqual({ enabled: false, confidence: 'exact' });
    expect(s.sources.jetbrains).toEqual({ enabled: true, confidence: 'exact' });
    expect('enabledSources' in s).toBe(false);
  });

  it('keeps a third-party source and drops an ill-shaped one', () => {
    write({
      sources: {
        aider: { enabled: true, confidence: 'exact' },
        'chatgpt-app': { enabled: false, confidence: 'heuristic' },
        'Not An Id': { enabled: true, confidence: 'exact' },
        '../escape': { enabled: true, confidence: 'exact' },
      },
    });
    const s = new SettingsStore(file).get();
    expect(s.sources.aider.enabled).toBe(true);
    expect(s.sources['chatgpt-app'].confidence).toBe('heuristic');
    expect('Not An Id' in s.sources).toBe(false);
    expect('../escape' in s.sources).toBe(false);
  });

  it('always keeps the built-in sources present', () => {
    write({ sources: { aider: { enabled: true, confidence: 'exact' } } });
    const s = new SettingsStore(file).get();
    expect(s.sources['claude-code']).toEqual({ enabled: true, confidence: 'exact' });
  });

  it('repairs an entry with the wrong types instead of throwing', () => {
    write({ sources: { aider: { enabled: 'yes', confidence: 'probably' } } });
    const s = new SettingsStore(file).get();
    expect(s.sources.aider).toEqual({ enabled: true, confidence: 'exact' });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — `s.sources` is `undefined`.

- [ ] **Step 3: Implement**

In `src/app/settings.ts`:

Replace the import at line 8 with:
```ts
import { BUILTIN_SOURCES, CONFIDENCES, SOURCE_ID_RE, type Confidence } from '../core/events.js';
import type { SourcePolicy } from '../core/sourceRegistry.js';
```

In `Settings`, replace `enabledSources: Record<SourceId, boolean>;` with:
```ts
  /**
   * Per-source policy. Any tool may appear here: an adapter that announces a
   * source we have never seen is registered on first contact.
   */
  sources: Record<string, SourcePolicy>;
```

In `DEFAULT_SETTINGS`, replace the `enabledSources` block with:
```ts
  sources: Object.fromEntries(
    BUILTIN_SOURCES.map((s) => [s, { enabled: true, confidence: 'exact' as Confidence }]),
  ),
```

Add above `coerce()`:

```ts
/**
 * The file is hand-editable and may still carry the pre-registry shape, so this
 * accepts three inputs — a `sources` object, a legacy `enabledSources` object,
 * or neither — and always returns something the app can run on. Built-ins are
 * re-added rather than resurrected as disabled: deleting a key should mean
 * "forget my customisation", never "switch this off".
 */
function coerceSources(raw: Record<string, unknown>): Record<string, SourcePolicy> {
  const out: Record<string, SourcePolicy> = {};

  const put = (id: string, enabled: unknown, confidence: unknown): void => {
    if (!SOURCE_ID_RE.test(id)) return;
    out[id] = {
      enabled: typeof enabled === 'boolean' ? enabled : true,
      confidence: (CONFIDENCES as readonly string[]).includes(confidence as string)
        ? (confidence as Confidence)
        : 'exact',
    };
  };

  const sources = raw.sources;
  if (typeof sources === 'object' && sources !== null && !Array.isArray(sources)) {
    for (const [id, value] of Object.entries(sources as Record<string, unknown>)) {
      const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
      put(id, v.enabled, v.confidence);
    }
  } else {
    // Migration: a file written before the registry existed.
    const legacy = raw.enabledSources;
    if (typeof legacy === 'object' && legacy !== null && !Array.isArray(legacy)) {
      for (const [id, value] of Object.entries(legacy as Record<string, unknown>)) {
        put(id, value, 'exact');
      }
    }
  }

  for (const id of BUILTIN_SOURCES) {
    out[id] ??= { enabled: true, confidence: 'exact' };
  }
  return out;
}
```

In `coerce()`, delete the `enabled` / `rawEnabled` block (lines 113–118) and replace `enabledSources: enabled,` in the returned object with `sources: coerceSources(r),`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS. `npm run typecheck` now fails in `turnRegistry.ts`, `tray.ts` and `main.ts` — Task 4 and Task 5 fix those.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings.ts tests/settings.test.ts
git commit -m "feat: store per-source policy and migrate enabledSources"
```

---

### Task 4: `TurnRegistry` consults the source registry

**Files:**
- Modify: `src/core/turnRegistry.ts:21-34` (`RegistryConfig`), `:66-72` (`RegistryOptions`), `:76-87` (constructor), `:113-140` (`dispatch`)
- Test: `tests/turnRegistry.test.ts`

**Interfaces:**
- Consumes: `SourceVerdict`, `BlockReason` (Task 2).
- Produces:
  - `RegistryConfig` loses `enabledSources` and keeps only `showDelayMs`, `watchdogMs`, `hideMode`.
  - `RegistryOptions` gains `admitSource?: (event: TurnEvent) => SourceVerdict` (default: always allow) and `onSourceBlocked?: (source: string, reason: BlockReason) => void`.

- [ ] **Step 1: Write the failing tests**

In `tests/turnRegistry.test.ts`, the existing case at line 94 sets `config.enabledSources.jetbrains = false`. Replace that case, and add the mid-turn case, using a new `admit` hook on the local `build()`:

```ts
  it('never opens a turn for a source that is not allowed', () => {
    const blocked: Array<[string, string]> = [];
    const r = new TurnRegistry({
      timers,
      getConfig: () => config,
      onVisibilityChange: (v) => visibility.push(v),
      admitSource: (e) =>
        e.source === 'chatgpt-app'
          ? { allowed: false, reason: 'disabled' as const }
          : { allowed: true, reason: null },
      onSourceBlocked: (source, reason) => blocked.push([source, reason]),
    });

    r.dispatch(ev('chatgpt-app', 't1', 'turn_started'));
    timers.advance(1000);

    expect(r.visible).toBe(false);
    expect(r.size).toBe(0);
    expect(blocked).toEqual([['chatgpt-app', 'disabled']]);
  });

  it('still closes a turn opened before the source was switched off', () => {
    let allowed = true;
    const r = new TurnRegistry({
      timers,
      getConfig: () => config,
      onVisibilityChange: (v) => visibility.push(v),
      admitSource: () => (allowed ? { allowed: true, reason: null } : { allowed: false, reason: 'disabled' as const }),
    });

    r.dispatch(ev('aider', 't1', 'turn_started'));
    timers.advance(500);
    expect(r.visible).toBe(true);

    allowed = false; // the user unchecks the source mid-turn
    r.dispatch(ev('aider', 't1', 'turn_ended', 'completed'));

    expect(r.visible).toBe(false); // the window must not be stranded
    expect(r.size).toBe(0);
  });
```

Also update the `ev` helper's first parameter type from `SourceId` to `string` (they are now the same type, but the import of `SourceId` should go).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/turnRegistry.test.ts`
Expected: FAIL — `admitSource` is not a known option, and the blocked source still opens a turn.

- [ ] **Step 3: Implement**

In `src/core/turnRegistry.ts`:

Change the import line to add the registry types:
```ts
import type { BlockReason, SourceVerdict } from './sourceRegistry.js';
```

Drop `enabledSources` from `RegistryConfig` and from `DEFAULT_REGISTRY_CONFIG`, leaving `RegistryConfig extends MachineConfig` with no extra members.

Add to `RegistryOptions`:
```ts
  /** may this source open turns? defaults to yes, so core tests stay simple */
  admitSource?: (event: TurnEvent) => SourceVerdict;
  onSourceBlocked?: (source: string, reason: BlockReason) => void;
```

Add the two private fields and their defaults in the constructor, alongside the existing ones:
```ts
  private readonly admitSource: (event: TurnEvent) => SourceVerdict;
  private readonly onSourceBlocked: (source: string, reason: BlockReason) => void;
```
```ts
    this.admitSource = opts.admitSource ?? (() => ({ allowed: true, reason: null }));
    this.onSourceBlocked = opts.onSourceBlocked ?? (() => {});
```

Replace the head of `dispatch`:

```ts
  dispatch(event: TurnEvent): void {
    const key = turnKey(event);
    let entry = this.entries.get(key);

    // Admission runs on every event, so a source is registered and counted even
    // when its first sighting is a close. A block stops a *new* turn, but never
    // a close for a turn already on screen: switching a source off mid-turn
    // must not strand the window.
    const verdict = this.admitSource(event);
    if (!verdict.allowed) {
      this.onSourceBlocked(event.source, verdict.reason ?? 'disabled');
      if (!entry) return;
    }

    if (!entry) {
      if (event.event !== 'turn_started') return;
      entry = {
        machine: new TurnStateMachine(key, this.getConfig()),
        source: event.source,
        turnId: event.turn_id,
        hideMode: this.getConfig().hideMode,
        showHandle: null,
        watchdogHandle: null,
      };
      this.entries.set(key, entry);
    }

    this.send(entry, { kind: 'event', event });
  }
```

Note this also removes the `cfg.enabledSources[event.source]` check and the now-redundant local `cfg`; `TurnStateMachine` takes the config object directly since `RegistryConfig` no longer carries extra members.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/turnRegistry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/turnRegistry.ts tests/turnRegistry.test.ts
git commit -m "feat: gate new turns on source admission, never their closes"
```

---

### Task 5: Wire the registry into the app and the menu bar

**Files:**
- Modify: `src/app/main.ts:55-63` (`registryConfig`), `:76-92` (registry construction), `:118-126` (tray deps)
- Modify: `src/app/tray.ts:13-18` (`SOURCE_LABELS`), `:26-33` (`TrayDeps`), `:127-139` (the `Sources` submenu)

**Interfaces:**
- Consumes: `SourceRegistry`, `SourceInfo`, `SourcePolicy` (Task 2); `settings.sources` (Task 3); `admitSource` / `onSourceBlocked` (Task 4).
- Produces: `TrayDeps` gains `sources: () => SourceInfo[]`.

No tests: the tray and `main.ts` are Electron composition and are uncovered today. Verification is `npm run typecheck` plus the manual check in Step 4.

- [ ] **Step 1: Build the registry in `main.ts`**

After the `SettingsStore` is constructed and before `TurnRegistry`, add:

```ts
const sourceRegistry = new SourceRegistry({
  getPolicies: () => settings.get().sources,
  onRegister: (source, policy) => {
    // First contact from a tool we have never seen: remember it so the user can
    // find it in the menu even when it is not currently running.
    settings.update({ sources: { ...settings.get().sources, [source]: policy } });
    console.log(`[focusreels] new source ${source} (${policy.confidence})`);
  },
});
```

with `import { SourceRegistry } from '../core/sourceRegistry.js';`.

Trim `registryConfig()` to the three surviving fields:

```ts
const registryConfig = (): RegistryConfig => {
  const s = settings.get();
  return { showDelayMs: s.showDelayMs, watchdogMs: s.watchdogMs, hideMode: s.hideMode };
};
```

Pass the two new options into `new TurnRegistry({ … })`:

```ts
  admitSource: (event) => sourceRegistry.admit(event),
  onSourceBlocked: (source, reason) => {
    console.log(`[focusreels] blocked ${source} (${reason})`);
    tray.refresh();
  },
```

- [ ] **Step 2: Make the menu build itself from the registry**

In `src/app/tray.ts`, type the labels as built-ins only and add a lookup that falls back to the raw id:

```ts
const SOURCE_LABELS: Partial<Record<string, string>> = {
  cursor: 'Cursor',
  'vscode-copilot': 'VS Code · Copilot',
  jetbrains: 'JetBrains AI',
  'claude-code': 'Claude Code (incl. Orca)',
  demo: 'Demo generator',
};
```

Add `sources: () => SourceInfo[];` to `TrayDeps`, importing `type SourceInfo` from `../core/sourceRegistry.js`.

Replace the `Sources` submenu with:

```ts
      {
        label: 'Sources',
        submenu: this.deps.sources().map((info) => ({
          // A raw id is safe to show: SOURCE_ID_RE forbids anything prose-shaped.
          label:
            (SOURCE_LABELS[info.source] ?? info.source) +
            (info.confidence === 'heuristic' ? ' (guess)' : ''),
          type: 'checkbox' as const,
          checked: info.enabled,
          click: () =>
            this.set({
              sources: {
                ...s.sources,
                [info.source]: { enabled: !info.enabled, confidence: info.confidence },
              },
            }),
        })),
      },
```

In `main.ts`, add `sources: () => sourceRegistry.list(),` to the `TrayController` deps.

- [ ] **Step 3: Typecheck and run the whole suite**

Run: `npm run typecheck` — expected: clean.
Run: `npx vitest run` — expected: whole suite green.

- [ ] **Step 4: Verify by hand**

```bash
npm run build && npm start
```
In a second terminal:
```bash
node dist/cli/emit.js --source aider --event turn_started --turn-id demo1
```
Expected: the player window appears after ~500 ms; the menu bar's **Sources** list now contains `aider`; `settings.json` has an `aider` entry. Then:
```bash
node dist/cli/emit.js --source aider --event turn_ended --turn-id demo1 --outcome completed
```
Expected: the window hides.

- [ ] **Step 5: Commit**

```bash
git add src/app/main.ts src/app/tray.ts
git commit -m "feat: register unknown sources and list them in the menu bar"
```

---

### Task 6: `--confidence` on the CLI, and the public protocol document

**Files:**
- Modify: `src/cli/emit.ts:93-97` (usage), `:100-112` (validation), `:139-146` (the sent object)
- Modify: `src/cli/demo.ts:13-40` (types only)
- Create: `docs/ADAPTER-PROTOCOL.md`
- Modify: `README.md` (link the new document from the adapters section)

**Interfaces:**
- Consumes: `SOURCE_ID_RE`, `CONFIDENCES` (Task 1).
- Produces: `focusreels-emit --confidence exact|heuristic`.

- [ ] **Step 1: Implement the CLI change**

In `src/cli/emit.ts`, replace the usage constant:

```ts
const USAGE = `focusreels-emit --source <id> --event <${EVENT_NAMES.join('|')}> --turn-id <id>
                 [--confidence ${CONFIDENCES.join('|')}]
                 [--outcome <${OUTCOMES.join('|')}>]
                 [--id-from-stdin <jsonField>] [--outcome-from-stdin <jsonField>]
                 [--socket <path>]

--source is any id matching [a-z0-9][a-z0-9-]{0,31}; built-ins: ${BUILTIN_SOURCES.join(', ')}.
--confidence heuristic marks a guessed turn; such a source stays off until the
user enables it in the menu bar.`;
```

After the existing `if (!source || !event)` guard, add:

```ts
  if (!SOURCE_ID_RE.test(source)) {
    // Still exit 0 — the contract with the IDE is that this never fails — but
    // say why, because the only person who sees it is the adapter's author.
    process.stderr.write(`focusreels-emit: invalid --source "${source}"\n${USAGE}\n`);
    return;
  }

  const confidence = args.confidence === 'heuristic' ? 'heuristic' : 'exact';
```

Add `confidence,` to the object passed to `sendEvent`.

Import `SOURCE_ID_RE`, `CONFIDENCES` and `BUILTIN_SOURCES` from `../core/events.js`.

- [ ] **Step 2: Verify by hand**

```bash
npm run build
node dist/cli/emit.js --source 'Bad Source' --event turn_started --turn-id x; echo "exit=$?"
```
Expected: the usage text on stderr and `exit=0`.

- [ ] **Step 3: Fix `demo.ts`**

`src/cli/demo.ts` imports `SourceId` and declares `const sources: SourceId[]` at line 92. `SourceId` is now `string`, so this compiles unchanged; run `npm run typecheck` and only adjust if it complains.

- [ ] **Step 4: Write `docs/ADAPTER-PROTOCOL.md`**

```markdown
# The FocusReels adapter protocol

Anything that knows when an AI agent starts and stops working can drive
FocusReels. You do not need to change this app, and you do not need our
permission — write one line of JSON to a socket.

## The socket

`$HOME/Library/Application Support/FocusReels/focusreels.sock`, mode `0600`.
Newline-delimited JSON, one event per line. Max 8 KB per line. No TCP port
exists, so nothing on the network can reach it.

## The event

```json
{ "source": "aider", "turn_id": "a1b2c3", "event": "turn_started", "confidence": "exact", "timestamp": 1730000000000 }
```

| Field | Required | Shape |
|---|---|---|
| `source` | yes | `[a-z0-9][a-z0-9-]{0,31}` — a stable id for your tool |
| `turn_id` | yes | `[A-Za-z0-9._:-]{1,128}` — opaque; a session or conversation id is ideal |
| `event` | yes | `turn_started` · `turn_progress` · `turn_ended` |
| `outcome` | on `turn_ended` | `completed` · `aborted` · `error` (default `completed`) |
| `confidence` | no | `exact` (default) · `heuristic` |
| `timestamp` | no | epoch ms; defaults to arrival |

Every other key is discarded. `sanitizeEvent` rebuilds the event field by field,
so an extra key cannot survive even if you send one.

## What you must not send

No prompt, no response, no code, no file path, no project name, no window title.
The field shapes are chosen so that content cannot fit through them: a `source`
cannot hold a path, and a `turn_id` cannot hold a sentence. Please keep the
spirit of that, not only the letter.

## `confidence`, and why an honest guess is rewarded

- `exact` — an API told you the turn started. Your source is **enabled on first
  contact** and works immediately.
- `heuristic` — you inferred it from a process, a UI, or a timer. Your source is
  **registered but disabled**, and the user turns it on in the menu bar.

A false window in the middle of someone's work costs more than a missed one, so
the app declines to guess on your behalf. Declaring `heuristic` is what makes
your adapter shippable to people who do not know you.

Confidence is fixed the first time a source is seen. Sending `exact` later does
not upgrade a source that introduced itself as a guess.

## The shortest possible adapter

```sh
emit() {
  printf '{"source":"my-agent","turn_id":"%s","event":"%s"}\n' "$1" "$2" \
    | nc -U "$HOME/Library/Application Support/FocusReels/focusreels.sock"
}
emit "$SESSION" turn_started
# … your agent runs …
emit "$SESSION" turn_ended
```

Or use the bundled CLI, which never fails and never prints to stdout:

```sh
node /path/to/focusreels/dist/cli/emit.js \
  --source my-agent --event turn_started --turn-id "$SESSION"
```

## Rules the app enforces

- A `turn_started` is shown only after the show delay (500 ms by default), so a
  fast answer never flashes a window.
- A turn nobody closes is closed by a watchdog after 10 minutes.
- At most 64 distinct sources are ever registered. Do not generate a fresh
  `source` per run — that is what `turn_id` is for.
- Switching a source off stops it opening new turns; it never strands a window
  that is already on screen.
```

- [ ] **Step 5: Link it from the README**

In `README.md`, in the adapters section, add a line before the per-IDE
subsections:

```markdown
Your tool is not on this list? It does not need to be — see
[`docs/ADAPTER-PROTOCOL.md`](docs/ADAPTER-PROTOCOL.md).
```

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: clean, green, and the build's `check-no-key.mjs` still passes.

- [ ] **Step 7: Commit**

```bash
git add src/cli/emit.ts src/cli/demo.ts docs/ADAPTER-PROTOCOL.md README.md
git commit -m "feat: document the adapter protocol and accept --confidence"
```
