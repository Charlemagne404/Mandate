import { contextBridge, ipcRenderer } from 'electron';

// Each method has one fixed IPC channel. Never expose ipcRenderer or paths.
contextBridge.exposeInMainWorld('mandateDesktop', {
  startOllama: () => ipcRenderer.invoke('mandate:start-ollama'),
  openFolder: (kind: 'saves' | 'scenarios' | 'exports' | 'logs') =>
    ipcRenderer.invoke('mandate:open-folder', kind),
  importSave: () => ipcRenderer.invoke('mandate:import-save'),
  exportSave: () => ipcRenderer.invoke('mandate:export-save'),
  configuration: async () => ({
    ...(await ipcRenderer.invoke('mandate:configuration')),
    sandboxed: process.sandboxed,
    contextIsolated: process.contextIsolated,
  }),
});
