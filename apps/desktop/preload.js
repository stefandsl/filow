// Exposes desktop-only settings to the page. Nothing here is a secret the page
// does not already need: the LAN access password gates the spend endpoints
// against other devices on the Wi-Fi, and the page is the engine.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("intelliprompter", {
  desktop: true,
  mode: process.env.INTELLIPROMPTER_SESSION_URL ? "hosted" : "lan",
  sessionUrl: process.env.INTELLIPROMPTER_SESSION_URL || `http://${process.env.INTELLIPROMPTER_LAN_IP || "127.0.0.1"}:${process.env.SESSION_PORT || 4748}`,
  /** What the phone opens: the public tunnel URL while "Share to phone on any network" is on, else the LAN address. */
  mirrorOrigin: process.env.INTELLIPROMPTER_PUBLIC_WEB || `http://${process.env.INTELLIPROMPTER_LAN_IP || "127.0.0.1"}:${process.env.PORT || 4747}`,
  /** The relay URL the phone uses (public tunnel while sharing). The engine itself keeps using sessionUrl. */
  mirrorServerUrl: process.env.INTELLIPROMPTER_PUBLIC_SESSION || "",
  remoteShare: Boolean(process.env.INTELLIPROMPTER_PUBLIC_WEB),
  /** Turn the public link (Cloudflare tunnel) on or off; the app reloads with new pairing URLs. */
  setRemoteShare: (on) => ipcRenderer.send("remote:set", Boolean(on)),
  remoteStatus: () => ipcRenderer.invoke("remote:status"),
  /** Auto-update state (installed app only): idle | checking | downloading | downloaded | none | error. */
  updateStatus: () => ipcRenderer.invoke("update:status"),
  checkForUpdates: () => ipcRenderer.send("update:check"),
  installUpdate: () => ipcRenderer.send("update:install"),
  onUpdateStatus: (fn) => {
    const h = (_e, v) => fn(v);
    ipcRenderer.on("update:status", h);
    return () => ipcRenderer.removeListener("update:status", h);
  },
  onRemoteStatus: (fn) => {
    const h = (_e, v) => fn(v);
    ipcRenderer.on("remote:status", h);
    return () => ipcRenderer.removeListener("remote:status", h);
  },
  accessPassword: process.env.ACCESS_PASSWORD || "",
  offline: process.env.INTELLIPROMPTER_OFFLINE === "1",
  /** Subscribe to the Offline menu toggle. */
  onOffline: (fn) => ipcRenderer.on("offline", (_e, v) => fn(Boolean(v))),
  /** The page tells the shell which UI language it uses, so the menu follows. */
  setLang: (lang) => ipcRenderer.send("ui:lang", lang),
  /** Screen Sense (ARCHITECTURE.md §6.1): sources, region picker, hotkey. Frames stay in memory. */
  screen: {
    sources: () => ipcRenderer.invoke("screen:sources"),
    select: (id) => ipcRenderer.invoke("screen:select", id),
    pickRegion: () => ipcRenderer.invoke("screen:pickRegion"),
    onHotkey: (fn) => {
      const h = () => fn();
      ipcRenderer.on("screen:hotkey", h);
      return () => ipcRenderer.removeListener("screen:hotkey", h);
    },
    onSettings: (fn) => {
      const h = (_e, v) => fn(v);
      ipcRenderer.on("screen:settings", h);
      return () => ipcRenderer.removeListener("screen:settings", h);
    },
    getSettings: () => ipcRenderer.invoke("screen:settings"),
    setSettings: (next) => ipcRenderer.invoke("screen:setSettings", next),
  },
});
