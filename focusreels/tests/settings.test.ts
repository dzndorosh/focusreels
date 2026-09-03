import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsStore } from '../src/app/settings.js';

/**
 * settings.json is meant to be hand-edited, so every value that reaches the
 * window has to survive a human (or a typo). These tests pin that contract.
 */
describe('SettingsStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'focusreels-settings-'));
    file = join(dir, 'settings.json');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (value: unknown) => writeFileSync(file, JSON.stringify(value), 'utf8');

  it('falls back to defaults when the file is missing', () => {
    expect(new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults when the file is not JSON', () => {
    writeFileSync(file, '{ not json at all', 'utf8');
    expect(new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numbers into their usable range', () => {
    write({ showDelayMs: -999, width: 99999, opacity: 42, volume: 7, margin: -5 });
    const s = new SettingsStore(file).get();
    expect(s.showDelayMs).toBe(0);
    expect(s.width).toBe(640);
    expect(s.opacity).toBe(1);
    expect(s.volume).toBe(1);
    expect(s.margin).toBe(0);
  });

  it('rejects values of the wrong type and unknown enum members', () => {
    write({ muted: 'yes', corner: 'middle', hideMode: 'whenever', width: 'big' });
    const s = new SettingsStore(file).get();
    expect(s.muted).toBe(DEFAULT_SETTINGS.muted);
    expect(s.corner).toBe(DEFAULT_SETTINGS.corner);
    expect(s.hideMode).toBe(DEFAULT_SETTINGS.hideMode);
    expect(s.width).toBe(DEFAULT_SETTINGS.width);
  });

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

  it('persists an update and notifies listeners', () => {
    const store = new SettingsStore(file);
    const seen: number[] = [];
    store.onChange((s) => seen.push(s.volume));

    store.update({ volume: 0.25, muted: false });

    expect(store.get().volume).toBe(0.25);
    expect(store.get().muted).toBe(false);
    expect(seen).toEqual([0.25]);
    expect(JSON.parse(readFileSync(file, 'utf8')).volume).toBe(0.25);
    expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow();
  });

  it('re-reads a file edited by hand', () => {
    const store = new SettingsStore(file);
    expect(store.get().width).toBe(DEFAULT_SETTINGS.width);

    write({ ...DEFAULT_SETTINGS, width: 400 });
    expect(store.reload().width).toBe(400);
  });
});
