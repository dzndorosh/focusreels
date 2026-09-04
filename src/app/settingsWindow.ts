import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { Settings } from './settings.js';

/**
 * The one ordinary, focusable window in FocusReels.  It is deliberately kept
 * separate from the non-activating video surfaces so opening preferences never
 * changes overlay behaviour.
 */
export class SettingsWindow {
  private win: BrowserWindow | null = null;

  show(): void {
    const win = this.win ?? this.create();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  push(settings: Settings): void {
    this.win?.webContents.send('focusreels:settings:changed', settings);
  }

  destroy(): void {
    this.win?.destroy();
    this.win = null;
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      title: 'FocusReels Settings',
      width: 560,
      height: 700,
      minWidth: 460,
      minHeight: 520,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#141416',
      webPreferences: {
        preload: join(__dirname, 'settingsPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    void win.loadFile(join(__dirname, 'renderer', 'settings.html'));
    this.win = win;
    return win;
  }
}
