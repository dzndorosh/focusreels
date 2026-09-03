/**
 * Menu-bar item: the whole settings surface for the MVP. Everything here maps
 * one-to-one onto a field in settings.json, which stays hand-editable.
 */

import { Menu, Tray, nativeImage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mediaDir } from '../broker/paths.js';
import type { Settings, SettingsStore } from './settings.js';
import { MAX_SOURCES, type SourceInfo } from '../core/sourceRegistry.js';

const SOURCE_LABELS: Partial<Record<string, string>> = {
  cursor: 'Cursor',
  'vscode-copilot': 'VS Code · Copilot',
  jetbrains: 'JetBrains AI',
  'claude-code': 'Claude Code (incl. Orca)',
  demo: 'Demo generator',
};

const DELAYS = [0, 250, 500, 1000, 2000];
const WIDTHS = [200, 260, 320, 400];

export interface TrayDeps {
  settings: SettingsStore;
  activeTurns: () => number;
  feedStatus: () => { demoMode: boolean; reason: string | null; queued: number };
  sources: () => SourceInfo[];
  /** events refused since launch (or since last "Forget third-party sources") because the cap was full */
  capRejected: () => number;
  onSimulateStart: () => void;
  onSimulateStop: () => void;
  onNextVideo: () => void;
  onRefreshFeed: () => void;
  onForgetThirdPartySources: () => void;
  onQuit: () => void;
}

export class TrayController {
  private tray: Tray | null = null;

  constructor(private readonly deps: TrayDeps) {}

  start(): void {
    this.tray = new Tray(this.icon());
    this.tray.setToolTip('FocusReels');
    this.render();
    this.deps.settings.onChange(() => this.render());
  }

  /**
   * A real template image, not an empty one: macOS does not reliably render a
   * status item that has no image, even when a title is set — which is exactly
   * how the icon went missing from the menu bar.
   */
  private icon() {
    const file = join(__dirname, 'assets', 'trayTemplate.png');
    if (existsSync(file)) {
      const image = nativeImage.createFromPath(file);
      if (!image.isEmpty()) {
        image.setTemplateImage(true); // follows the light/dark menu bar
        return image;
      }
    }
    console.warn('[tray] icon missing — run `node scripts/make-tray-icon.mjs`');
    return nativeImage.createEmpty();
  }

  /** called on every turn change so the menu shows live state */
  refresh(): void {
    this.render();
  }

  private set(patch: Partial<Settings>): void {
    this.deps.settings.update(patch);
  }

  private render(): void {
    if (!this.tray) return;
    const s = this.deps.settings.get();
    const active = this.deps.activeTurns();

    const feed = this.deps.feedStatus();
    const feedLine = feed.demoMode
      ? `Demo mode${feed.reason ? ` · ${feed.reason}` : ''}`
      : `Feed: ${feed.queued} queued`;

    const menu = Menu.buildFromTemplate([
      { label: active > 0 ? `${active} turn(s) in flight` : 'Idle', enabled: false },
      { label: feedLine, enabled: false },
      { type: 'separator' },
      {
        label: 'Player',
        submenu: [
          {
            label: 'YouTube feed (326×720)',
            type: 'radio' as const,
            checked: s.player === 'youtube',
            click: () => this.set({ player: 'youtube' }),
          },
          {
            label: 'Local clips (small overlay)',
            type: 'radio' as const,
            checked: s.player === 'local',
            click: () => this.set({ player: 'local' }),
          },
        ],
      },
      { type: 'separator' },
      {
        label: 'Mute',
        type: 'checkbox',
        checked: s.muted,
        click: () => this.set({ muted: !s.muted }),
      },
      {
        label: 'Click-through (ignore mouse)',
        type: 'checkbox',
        checked: s.clickThrough,
        click: () => this.set({ clickThrough: !s.clickThrough }),
      },
      {
        label: 'Swipe to change clip',
        type: 'checkbox',
        checked: s.swipe,
        // The gesture needs the mouse over the whole video, so this trades a
        // little click-through away — worth saying out loud in the menu.
        toolTip: 'While hovering, the overlay takes the mouse instead of passing it through',
        click: () => this.set({ swipe: !s.swipe }),
      },
      { type: 'separator' },
      {
        label: 'Sources',
        submenu: [
          ...this.deps.sources().map((info) => ({
            // A raw id is safe to show: SOURCE_ID_RE forbids anything prose-shaped.
            label:
              (SOURCE_LABELS[info.source] ?? info.source) +
              (info.confidence === 'heuristic' ? ' (guess)' : ''),
            type: 'checkbox' as const,
            checked: info.enabled,
            // Read settings fresh here rather than closing over `s`: a source can
            // register (sourceRegistry.onRegister -> settings.update) after this
            // menu was rendered but before the click, and `sources` is replaced
            // wholesale (not deep-merged) on write — closing over the stale `s`
            // would silently drop that newly registered source from settings.json.
            click: () =>
              this.set({
                sources: {
                  ...this.deps.settings.get().sources,
                  [info.source]: { enabled: !info.enabled, confidence: info.confidence },
                },
              }),
          })),
          ...(this.deps.capRejected() > 0
            ? [
                {
                  label: `${this.deps.capRejected()} event(s) refused — source list is full (${MAX_SOURCES} max)`,
                  enabled: false,
                },
              ]
            : []),
          { type: 'separator' as const },
          {
            label: 'Forget third-party sources',
            click: () => this.deps.onForgetThirdPartySources(),
          },
        ],
      },
      {
        label: 'Show after',
        submenu: DELAYS.map((ms) => ({
          label: ms === 0 ? 'immediately' : `${ms} ms`,
          type: 'radio' as const,
          checked: s.showDelayMs === ms,
          click: () => this.set({ showDelayMs: ms }),
        })),
      },
      {
        label: 'Hide when',
        submenu: [
          {
            label: 'the agent fully finishes',
            type: 'radio' as const,
            checked: s.hideMode === 'full-completion',
            click: () => this.set({ hideMode: 'full-completion' }),
          },
          {
            label: 'the first response arrives',
            type: 'radio' as const,
            checked: s.hideMode === 'first-response',
            click: () => this.set({ hideMode: 'first-response' }),
          },
        ],
      },
      {
        label: 'Corner',
        submenu: (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((c) => ({
          label: c.replace('-', ' '),
          type: 'radio' as const,
          checked: s.corner === c,
          click: () => this.set({ corner: c }),
        })),
      },
      {
        label: 'Size',
        submenu: WIDTHS.map((w) => ({
          label: `${w} × ${Math.round((w * 16) / 9)}`,
          type: 'radio' as const,
          checked: s.width === w,
          click: () => this.set({ width: w }),
        })),
      },
      { type: 'separator' },
      { label: 'Open media folder…', click: () => void shell.openPath(mediaDir()) },
      {
        label: 'Open settings.json…',
        click: () => void shell.openPath(this.deps.settings.path),
      },
      { label: 'Reload settings from disk', click: () => this.deps.settings.reload() },
      { type: 'separator' },
      {
        // Temporary, for the MVP: drives the real pipeline, not a shortcut.
        label: 'Simulate',
        submenu: [
          { label: 'AI start', click: () => this.deps.onSimulateStart() },
          { label: 'AI stop', click: () => this.deps.onSimulateStop() },
          { type: 'separator' as const },
          { label: 'Next video', click: () => this.deps.onNextVideo() },
          { label: 'Refresh feed', click: () => this.deps.onRefreshFeed() },
        ],
      },
      { type: 'separator' },
      { label: 'Quit FocusReels', click: () => this.deps.onQuit() },
    ]);

    this.tray.setContextMenu(menu);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
