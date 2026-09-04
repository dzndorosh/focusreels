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
      title: 'FocusReels',
      width: 500,
      height: 680,
      minWidth: 500,
      minHeight: 680,
      maxWidth: 500,
      maxHeight: 680,
      titleBarStyle: 'hiddenInset',
      show: false,
      resizable: false,
      autoHideMenuBar: true,
      backgroundColor: '#4a4a4a',
      webPreferences: {
        preload: join(__dirname, 'settingsPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    void win.loadFile(join(__dirname, 'renderer', 'control-center.html'));
    this.win = win;
    return win;
  }
}
