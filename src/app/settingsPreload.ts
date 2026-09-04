import { contextBridge, ipcRenderer } from 'electron';

/** Settings UI gets a deliberately small capability surface. */
contextBridge.exposeInMainWorld('focusreelsSettings', {
  get: (): Promise<unknown> => ipcRenderer.invoke('focusreels:settings:get'),
  update: (patch: unknown): Promise<unknown> => ipcRenderer.invoke('focusreels:settings:update', patch),
  openFile: (): Promise<unknown> => ipcRenderer.invoke('focusreels:settings:open-file'),
  onChanged: (fn: (settings: unknown) => void): void => {
    ipcRenderer.on('focusreels:settings:changed', (_event, settings) => fn(settings));
  },
});
