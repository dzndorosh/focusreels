import type { Corner, PlayerMode, Settings } from './settings.js';
import type { HideMode } from '../core/turnStateMachine.js';
import { CONFIDENCES, SOURCE_ID_RE, type Confidence } from '../core/events.js';
import { MAX_SOURCES, type SourcePolicy } from '../core/sourceRegistry.js';

/** Only fields presented by the Settings window may cross its IPC boundary. */
export type SettingsPatch = Pick<
  Settings,
  | 'player'
  | 'sources'
  | 'enabled'
  | 'muted'
  | 'alwaysOnTop'
  | 'launchAtLogin'
  | 'volume'
  | 'showDelayMs'
  | 'watchdogMs'
  | 'idleWatchdogMs'
  | 'hideMode'
  | 'corner'
  | 'width'
  | 'margin'
  | 'opacity'
  | 'clickThrough'
  | 'swipe'
  | 'scrollToChange'
  | 'nineAnchors'
  | 'regionCode'
>;

const corners = new Set<Corner>(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const players = new Set<PlayerMode>(['youtube', 'local']);
const hideModes = new Set<HideMode>(['first-response', 'full-completion']);

const booleans = [
  'enabled',
  'muted',
  'alwaysOnTop',
  'launchAtLogin',
  'clickThrough',
  'swipe',
  'scrollToChange',
  'nineAnchors',
] as const;
const numbers = [
  'volume',
  'showDelayMs',
  'watchdogMs',
  'idleWatchdogMs',
  'width',
  'margin',
  'opacity',
] as const;

export function parseSettingsPatch(value: unknown): SettingsPatch | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const patch: Partial<SettingsPatch> = {};

  for (const key of booleans) {
    if (typeof input[key] === 'boolean') patch[key] = input[key] as never;
  }
  for (const key of numbers) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) {
      patch[key] = input[key] as never;
    }
  }
  if (players.has(input.player as PlayerMode)) patch.player = input.player as PlayerMode;
  if (hideModes.has(input.hideMode as HideMode)) patch.hideMode = input.hideMode as HideMode;
  if (corners.has(input.corner as Corner)) patch.corner = input.corner as Corner;
  if (typeof input.regionCode === 'string' && /^[A-Za-z]{2}$/.test(input.regionCode)) {
    patch.regionCode = input.regionCode.toUpperCase();
  }
  if (typeof input.sources === 'object' && input.sources !== null && !Array.isArray(input.sources)) {
    const sources: Record<string, SourcePolicy> = {};
    for (const [id, value] of Object.entries(input.sources as Record<string, unknown>).slice(0, MAX_SOURCES)) {
      if (!SOURCE_ID_RE.test(id) || typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const policy = value as Record<string, unknown>;
      if (typeof policy.enabled !== 'boolean') continue;
      const confidence = (CONFIDENCES as readonly string[]).includes(policy.confidence as string)
        ? policy.confidence as Confidence
        : 'exact';
      sources[id] = { enabled: policy.enabled, confidence };
    }
    if (Object.keys(sources).length > 0) patch.sources = sources;
  }

  return Object.keys(patch).length > 0 ? patch as SettingsPatch : null;
}
