const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("filowWelcome", {
  getPreferences: () => ipcRenderer.invoke("ui:getPreferences"),
  updatePreferences: patch => ipcRenderer.invoke("ui:updatePreferences", patch),
  onPreferencesChanged: fn => {
    const listener = (_event, state) => fn(state);
    ipcRenderer.on("ui:preferencesChanged", listener);
    return () => ipcRenderer.removeListener("ui:preferencesChanged", listener);
  },
  complete: practice => ipcRenderer.invoke("welcome:complete", practice === true),
  // First-run guide (docs/welcome/ONBOARDING-V2.md): which steps to show, the speech-setup offer and its answer.
  context: () => ipcRenderer.invoke("welcome:context"),
  setupOffer: () => ipcRenderer.invoke("welcome:setupOffer"),
  // cleanup: the step's "S1-mini by Superwhisper" line (ticked unless the user unticked it).
  chooseSetup: (accept, cleanup) => ipcRenderer.invoke("welcome:chooseSetup", accept === true, cleanup !== false),
  // Fixed destination (the OS microphone privacy page); the renderer cannot pass a URL.
  openMicSettings: () => ipcRenderer.send("welcome:openMicSettings"),
});
// Lifecycle acknowledgement is internal, not an arbitrary IPC capability.
window.addEventListener("filow:hydrated", () => ipcRenderer.send("welcome:ready"), { once: true });
