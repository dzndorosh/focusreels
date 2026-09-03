import { contextBridge, ipcRenderer } from 'electron';

/**
 * The renderer gets a playlist of local file paths, four status channels, and
 * two levers it needs for interactive controls:
 *
 *  - `setPointerGrab` — "the pointer is over a control, give me the mouse".
 *    The video body stays click-through; only the control zones grab.
 *  - `saveAudio` — persist mute/volume so the choice survives the next turn.
 *
 * No node, no fs, no network: the player is a video surface, not a program.
 */
contextBridge.exposeInMainWorld('focusreels', {
  playlist: (): Promise<string[]> => ipcRenderer.invoke('focusreels:playlist'),
  setPointerGrab: (grab: boolean): void => {
    ipcRenderer.send('focusreels:pointer-grab', Boolean(grab));
  },
  saveAudio: (muted: boolean, volume: number): void => {
    ipcRenderer.send('focusreels:audio', {
      muted: Boolean(muted),
      volume: Number(volume),
    });
  },
  onShow: (fn: (s: unknown) => void) => ipcRenderer.on('show', (_e, s) => fn(s)),
  onHide: (fn: () => void) => ipcRenderer.on('hide', () => fn()),
  onStatus: (fn: (s: unknown) => void) => ipcRenderer.on('status', (_e, s) => fn(s)),
  onSettings: (fn: (s: unknown) => void) => ipcRenderer.on('settings', (_e, s) => fn(s)),
});
