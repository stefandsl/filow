const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("filowWelcome", {
  glass: process.argv.includes("--filow-glass"),
  getPreferences: () => ipcRenderer.invoke("ui:getPreferences"),
  updatePreferences: patch => ipcRenderer.invoke("ui:updatePreferences", patch),
  onPreferencesChanged: fn => {
    const listener = (_event, state) => fn(state);
    ipcRenderer.on("ui:preferencesChanged", listener);
    return () => ipcRenderer.removeListener("ui:preferencesChanged", listener);
  },
  complete: () => ipcRenderer.invoke("welcome:complete"),
});
// Lifecycle acknowledgement is internal, not an arbitrary IPC capability.
window.addEventListener("filow:hydrated", () => ipcRenderer.send("welcome:ready"), { once: true });
