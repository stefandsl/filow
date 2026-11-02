// Exposes desktop-only settings to the page. Nothing here is a secret the page
// does not already need: the LAN access password gates the spend endpoints
// against other devices on the Wi-Fi, and the page is the engine.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("filow", {
  desktop: true,
  /** The window is acrylic (Windows 11) or vibrancy (macOS): the page keeps its background transparent. */
  glass: process.argv.includes("--filow-glass"),
  mode: process.env.FILOW_SESSION_URL ? "hosted" : "lan",
  sessionUrl: process.env.FILOW_SESSION_URL || `http://${process.env.FILOW_LAN_IP || "127.0.0.1"}:${process.env.SESSION_PORT || 4748}`,
  /** What the phone opens: the public tunnel URL while "Share to phone on any network" is on, else the LAN address. */
  mirrorOrigin: process.env.FILOW_PUBLIC_WEB || `http://${process.env.FILOW_LAN_IP || "127.0.0.1"}:${process.env.PORT || 4747}`,
  /** The relay URL the phone uses (public tunnel while sharing). The engine itself keeps using sessionUrl. */
  mirrorServerUrl: process.env.FILOW_PUBLIC_SESSION || "",
  remoteShare: Boolean(process.env.FILOW_PUBLIC_WEB),
  /** Turn the public link (Cloudflare tunnel) on or off; the app reloads with new pairing URLs. */
  setRemoteShare: (on) => ipcRenderer.send("remote:set", Boolean(on)),
  remoteStatus: () => ipcRenderer.invoke("remote:status"),
  /** Auto-update state (installed app only): idle | checking | downloading | downloaded | none | error. */
  updateStatus: () => ipcRenderer.invoke("update:status"),
  /** Diagnostics: the page keeps the main process informed of its take log; "report" opens the issue form. */
  takeLog: (text) => ipcRenderer.send("diag:takeLog", text),
  reportProblem: () => ipcRenderer.send("diag:report"),
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
  offline: process.env.FILOW_OFFLINE === "1",
  /** Subscribe to the Offline menu toggle. */
  onOffline: (fn) => ipcRenderer.on("offline", (_e, v) => fn(Boolean(v))),
  /** The page tells the shell which UI language it uses, so the menu follows. */
  setLang: (lang) => ipcRenderer.send("ui:lang", lang),
  /** system | light | dark; the shell colours (title bar, dialogs, splash) follow. */
  setTheme: (theme) => ipcRenderer.send("ui:theme", theme),
  reportSession: (info) => ipcRenderer.send("session:report", info),
  /** Live slide show (PowerPoint via COM / AppleScript): {running, index, total, title}. */
  slideshowState: () => ipcRenderer.invoke("slideshow:state"),
  onSlideshow: (fn) => {
    const h = (_e, v) => fn(v);
    ipcRenderer.on("slideshow", h);
    return () => ipcRenderer.removeListener("slideshow", h);
  },
  closeOverlay: () => ipcRenderer.send("overlay:close"),
  /** Streaming speech-to-text on this PC (sherpa-onnx + Nemotron in a worker thread of the shell). */
  stt: {
    status: () => ipcRenderer.invoke("stt:status"),
    download: () => ipcRenderer.send("stt:download"),
    remove: () => ipcRenderer.invoke("stt:remove"),
    start: (language) => ipcRenderer.invoke("stt:start", language),
    feed: (samples) => ipcRenderer.send("stt:feed", samples),
    stop: () => ipcRenderer.send("stt:stop"),
    onResult: (fn) => {
      const h = (_e, v) => fn(v);
      ipcRenderer.on("stt:result", h);
      return () => ipcRenderer.removeListener("stt:result", h);
    },
    onStatus: (fn) => {
      const h = (_e, v) => fn(v);
      ipcRenderer.on("stt:status", h);
      return () => ipcRenderer.removeListener("stt:status", h);
    },
  },
  /** Phone on this network: which adapter/IP the QR uses, the Windows Firewall state, and fixes. */
  net: {
    status: () => ipcRenderer.invoke("net:status"),
    allowFirewall: () => ipcRenderer.invoke("net:allowFirewall"),
    useInterface: (address) => ipcRenderer.invoke("net:useInterface", address),
  },
  /** Local AI setup: hardware scan + recommendation, unattended Ollama install with progress. */
  localAi: {
    status: () => ipcRenderer.invoke("localai:status"),
    hardware: () => ipcRenderer.invoke("localai:hardware"),
    install: () => ipcRenderer.send("localai:install"),
    onStatus: (fn) => {
      const h = (_e, v) => fn(v);
      ipcRenderer.on("localai:status", h);
      return () => ipcRenderer.removeListener("localai:status", h);
    },
  },
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
