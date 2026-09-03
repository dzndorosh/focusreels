/**
 * The overlay panel.
 *
 * Three properties matter more than anything visual:
 *  1. it never takes focus     — focusable:false + showInactive()
 *  2. it never eats input      — setIgnoreMouseEvents(true, { forward: true })
 *  3. it floats over the IDE   — always-on-top at 'screen-saver' level,
 *                                visible on every Space and over fullscreen
 */

import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { Settings } from './settings.js';

const ASPECT = 16 / 9; // vertical video

export interface OverlayStatus {
  source: string;
  startedAt: number;
  parallel: number;
}

export class OverlayWindow {
  private win: BrowserWindow | null = null;
  private ready = false;
  private pendingStatus: OverlayStatus | null = null;
  /** true while the renderer has asked for the mouse (pointer over a control) */
  private grabbingPointer = false;

  constructor(private settings: Settings) {}

  private create(): BrowserWindow {
    const height = Math.round(this.settings.width * ASPECT);
    const win = new BrowserWindow({
      width: this.settings.width,
      height,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false, // never steals keyboard focus
      skipTaskbar: true,
      // The app is an accessory and never becomes active, so *every* click on
      // the overlay is a "first mouse". Without this the system swallows them
      // all as activation clicks and no control ever fires.
      acceptFirstMouse: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    // Above normal windows and above fullscreen apps, without being a window
    // the user can tab to.
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(this.settings.clickThrough, { forward: true });
    win.setOpacity(this.settings.opacity);
    this.grabbingPointer = false;

    win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });

    win.webContents.on('did-finish-load', () => {
      this.ready = true;
      this.push('settings', this.rendererSettings());
      if (this.pendingStatus) {
        this.push('show', this.pendingStatus);
        this.pendingStatus = null;
      }
    });

    // An overlay has no business opening links or navigating anywhere.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    if (process.env.FOCUSREELS_DEBUG) {
      // The renderer has no visible console in a frameless, focusless panel.
      win.webContents.on('console-message', (_e, _level, message) => {
        console.log('[renderer]', message);
      });
    }

    void win.loadFile(join(__dirname, 'renderer', 'player.html'));
    return win;
  }

  private rendererSettings() {
    return {
      muted: this.settings.muted,
      volume: this.settings.volume,
      clickThrough: this.settings.clickThrough,
      swipe: this.settings.swipe,
    };
  }

  /**
   * Point-in-time pointer grab, driven by the renderer.
   *
   * `forward: true` keeps mousemove flowing to the page even while the window
   * ignores the mouse, so the renderer can tell when the pointer is over a
   * control and ask for it — the video body stays click-through, the buttons
   * work. Focus is never taken either way: the window is `focusable: false`.
   */
  setPointerGrab(grab: boolean): void {
    if (this.settings.clickThrough === false) return; // already fully interactive
    if (grab === this.grabbingPointer) return;
    this.grabbingPointer = grab;
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(!grab, { forward: true });
    if (process.env.FOCUSREELS_DEBUG) {
      console.log(`[overlay] pointer ${grab ? 'grabbed' : 'released'}`);
    }
  }

  private push(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed() && this.ready) {
      this.win.webContents.send(channel, payload);
    }
  }

  private position(win: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const { width, height } = win.getBounds();
    const m = this.settings.margin;

    const left = this.settings.corner.endsWith('left');
    const top = this.settings.corner.startsWith('top');
    const x = left ? area.x + m : area.x + area.width - width - m;
    const y = top ? area.y + m : area.y + area.height - height - m;
    win.setPosition(Math.round(x), Math.round(y), false);
  }

  show(status: OverlayStatus): void {
    if (!this.win || this.win.isDestroyed()) {
      this.win = this.create();
      this.ready = false;
    }
    const win = this.win;
    this.position(win);

    if (this.ready) this.push('show', status);
    else this.pendingStatus = status;

    // showInactive, never show(): show() would activate the app and pull focus
    // away from the editor the user is still typing in.
    if (!win.isVisible()) win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    if (process.env.FOCUSREELS_DEBUG) {
      console.log('[overlay] bounds', JSON.stringify(win.getBounds()),
        'visible', win.isVisible(), 'opacity', win.getOpacity());
    }
  }

  updateStatus(status: OverlayStatus): void {
    this.push('status', status);
  }

  hide(): void {
    // Release the mouse before disappearing, or the next show would start out
    // holding a grab nothing is hovering any more.
    this.setPointerGrab(false);
    this.push('hide', null);
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  applySettings(settings: Settings): void {
    const previous = this.settings;
    this.settings = settings;
    const win = this.win;
    if (!win || win.isDestroyed()) return;

    if (settings.width !== previous.width) {
      win.setBounds({
        width: settings.width,
        height: Math.round(settings.width * ASPECT),
      });
    }
    if (settings.opacity !== previous.opacity) win.setOpacity(settings.opacity);

    // Only re-arm the mouse when the click-through *policy* changed. Saving the
    // volume also lands here, and resetting the grab mid-drag would yank the
    // mouse out from under the slider the user is holding.
    if (settings.clickThrough !== previous.clickThrough) {
      this.grabbingPointer = false;
      win.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
    }

    if (settings.corner !== previous.corner || settings.width !== previous.width) {
      this.position(win);
    }
    this.push('settings', this.rendererSettings());
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  get isVisible(): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible());
  }
}
