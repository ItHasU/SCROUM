/** Pont (contextIsolation) entre la fenêtre d'accueil et le processus principal. */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('scroum', {
  openRepo: (path?: string) => ipcRenderer.invoke('open-repo', path),
  openZip: (path?: string) => ipcRenderer.invoke('open-zip', path),
  recent: () => ipcRenderer.invoke('recent'),
  clearRecent: () => ipcRenderer.invoke('clear-recent'),
  version: () => ipcRenderer.invoke('version'),
});
