/**
 * Settings live in one JSON file next to the socket, editable by hand.
 * Reads are cached; a change applies to the next turn, never to a running one.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { BUILTIN_SOURCES, type SourceId } from '../core/events.js';
import {
  DEFAULT_ANCHOR,
  isAnchor,
  isMode,
  type SavedWindowPlacement,
} from './anchors.js';
import type { HideMode } from '../core/turnStateMachine.js';
import { settingsPath } from '../broker/paths.js';

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** `youtube` opens the 326×720 feed window; `local` keeps the small overlay. */
export type PlayerMode = 'youtube' | 'local';

export interface Settings {
  /** per-IDE switch — an off source never opens a turn */
  enabledSources: Record<SourceId, boolean>;
  /** how long the wait must last before anything appears */
  showDelayMs: number;
  /** hard stop for a turn no adapter ever closed */
  watchdogMs: number;
  hideMode: HideMode;
  muted: boolean;
  /** 0…1, remembered across turns so the user sets it once */
  volume: number;
  corner: Corner;
  /** overlay width in px; height follows a 9:16 frame */
  width: number;
  margin: number;
  opacity: number;
  player: PlayerMode;
  /** ISO-3166-1 alpha-2, used for the regional `mostPopular` chart */
  regionCode: string;
  /** where the feed window sits, and whether it is collapsed */
  placement: SavedWindowPlacement;
  /**
   * Scroll over the video to change clip. A cross-origin player swallows the
   * wheel, so this needs a transparent capture layer over the video — which is
   * why it is a switch and not a given.
   */
  scrollToChange: boolean;
  /**
   * Magnet to all nine positions instead of the four corners. Corners are the
   * default because that is what system Picture in Picture does.
   */
  nineAnchors: boolean;
  /** true = the overlay is invisible to mouse and keyboard */
  clickThrough: boolean;
  /**
   * Swipe / scroll to change clip. The gesture happens over the video body, so
   * turning it on means the overlay takes the mouse for as long as the pointer
   * is over it — clicks land in the player, not in the IDE behind it. Off, only
   * the controls take the mouse and the body stays click-through.
   */
  swipe: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabledSources: {
    cursor: true,
    'vscode-copilot': true,
    jetbrains: true,
    'claude-code': true,
    demo: true,
  },
  showDelayMs: 500,
  watchdogMs: 10 * 60 * 1000,
  hideMode: 'full-completion',
  muted: true,
  volume: 0.6,
  corner: 'bottom-right',
  width: 260,
  margin: 24,
  opacity: 1,
  clickThrough: true,
  swipe: true,
  player: 'youtube',
  regionCode: 'US',
  placement: { anchor: DEFAULT_ANCHOR, mode: 'expanded' },
  scrollToChange: true,
  nineAnchors: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A saved placement is a hint, never a command: a monitor that has since been
 * unplugged, or a hand-edited anchor, must not be able to park the window
 * somewhere it cannot be reached.
 */
function coercePlacement(raw: unknown): SavedWindowPlacement {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const placement: SavedWindowPlacement = {
    anchor: isAnchor(r.anchor) ? r.anchor : DEFAULT_ANCHOR,
    mode: isMode(r.mode) ? r.mode : 'expanded',
  };
  if (typeof r.displayId === 'string' && r.displayId.length > 0) {
    placement.displayId = r.displayId;
  }
  return placement;
}

function coerce(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const enabled = { ...DEFAULT_SETTINGS.enabledSources };
  const rawEnabled = r.enabledSources as Record<string, unknown> | undefined;
  if (rawEnabled) {
    for (const s of BUILTIN_SOURCES) {
      if (typeof rawEnabled[s] === 'boolean') enabled[s] = rawEnabled[s] as boolean;
    }
  }
  const num = (key: keyof Settings, lo: number, hi: number): number => {
    const v = r[key];
    return typeof v === 'number' && Number.isFinite(v)
      ? clamp(v, lo, hi)
      : (DEFAULT_SETTINGS[key] as number);
  };
  const bool = (key: keyof Settings): boolean =>
    typeof r[key] === 'boolean' ? (r[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean);

  const corner =
    typeof r.corner === 'string' &&
    ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(r.corner)
      ? (r.corner as Corner)
      : DEFAULT_SETTINGS.corner;

  const hideMode: HideMode =
    r.hideMode === 'first-response' || r.hideMode === 'full-completion'
      ? r.hideMode
      : DEFAULT_SETTINGS.hideMode;

  return {
    enabledSources: enabled,
    showDelayMs: num('showDelayMs', 0, 10_000),
    watchdogMs: num('watchdogMs', 5_000, 60 * 60_000),
    hideMode,
    muted: bool('muted'),
    volume: num('volume', 0, 1),
    corner,
    width: num('width', 160, 640),
    margin: num('margin', 0, 400),
    opacity: num('opacity', 0.2, 1),
    clickThrough: bool('clickThrough'),
    swipe: bool('swipe'),
    player: r.player === 'local' || r.player === 'youtube' ? r.player : DEFAULT_SETTINGS.player,
    placement: coercePlacement(r.placement),
    scrollToChange: bool('scrollToChange'),
    nineAnchors: bool('nineAnchors'),
    // Two letters only — anything else would just make the API reject the call.
    regionCode:
      typeof r.regionCode === 'string' && /^[A-Za-z]{2}$/.test(r.regionCode)
        ? r.regionCode.toUpperCase()
        : DEFAULT_SETTINGS.regionCode,
  };
}

export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(private readonly file: string = settingsPath()) {
    this.current = this.read();
  }

  get(): Settings {
    return this.current;
  }

  private read(): Settings {
    try {
      return coerce(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  /** Re-read from disk — the file is meant to be hand-editable. */
  reload(): Settings {
    this.current = this.read();
    this.emit();
    return this.current;
  }

  update(patch: Partial<Settings>): Settings {
    this.current = coerce({ ...this.current, ...patch });
    this.save();
    this.emit();
    return this.current;
  }

  save(): void {
    try {
      const directory = dirname(this.file);
      mkdirSync(directory, { recursive: true });
      // A settings file is deliberately hand-editable.  Replacing it atomically
      // means an interrupted save cannot turn a valid file into partial JSON.
      const temporary = join(directory, `.${basename(this.file)}.${process.pid}.tmp`);
      writeFileSync(temporary, JSON.stringify(this.current, null, 2) + '\n', 'utf8');
      renameSync(temporary, this.file);
    } catch (err) {
      console.error('[settings] could not save:', (err as Error).message);
    }
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.current);
  }

  get path(): string {
    return this.file;
  }
}
