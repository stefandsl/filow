// Bridge for about.html (About and privacy, Report a problem). Every channel answers only this window.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("filowAbout", {
  data: () => ipcRenderer.invoke("about:data"),
  openConfigFolder: () => ipcRenderer.invoke("about:openConfigFolder"),
  report: () => ipcRenderer.invoke("report:data"),
  preview: (description) => ipcRenderer.invoke("report:preview", String(description || "")),
  save: (description) => ipcRenderer.invoke("report:save", String(description || "")),
  copy: (description) => ipcRenderer.invoke("report:copy", String(description || "")),
  openCrashFolder: () => ipcRenderer.invoke("report:openCrashFolder"),
  issue: (description) => ipcRenderer.invoke("report:issue", String(description || "")),
  close: () => ipcRenderer.invoke("about:close"),
  onView: (fn) => ipcRenderer.on("about:view", (_e, view) => fn(view)),
});
