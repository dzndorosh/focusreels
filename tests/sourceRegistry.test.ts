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
