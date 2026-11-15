const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('filow', { desktop: true, okFilow: {
  status: () => ipcRenderer.invoke('qa:status'),
  configure: patch => ipcRenderer.invoke('qa:configure',patch),
  wakeAction: (action,data) => ipcRenderer.invoke('qa:wake',action,data),
} });
