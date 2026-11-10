// Exposes desktop-only settings to the page. Nothing here is a secret the page
// does not already need: the LAN access password gates the spend endpoints
// against other devices on the Wi-Fi, and the page is the engine.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("filow", {
  desktop: true,
  /** OK Filow's section in Filow Settings (same settings as its panel). */
  okFilow: {
    status: () => ipcRenderer.invoke("okfilow:settings:status"),
    configure: (patch) => ipcRenderer.invoke("okfilow:settings:configure", patch),
    openPanel: () => ipcRenderer.send("okfilow:settings:openPanel"),
  },
  getPreferences: () => ipcRenderer.invoke("ui:getPreferences"),
  updatePreferences: patch => ipcRenderer.invoke("ui:updatePreferences", patch),
  migrateUiPreferences: patch => ipcRenderer.invoke("ui:migratePreferences", patch),
  onPreferencesChanged: fn => {
    const listener = (_event, state) => fn(state);
    ipcRenderer.on("ui:preferencesChanged", listener);
    return () => ipcRenderer.removeListener("ui:preferencesChanged", listener);
  },
  mode: process.env.FILOW_SESSION_URL ? "hosted" : "lan",
  sessionUrl: process.env.FILOW_SESSION_URL || `http://${process.env.FILOW_LAN_IP || "127.0.0.1"}:${process.env.SESSION_PORT || 4748}`,
  /** What the phone opens: the public tunnel URL while "Share to phone on any network" is on, else the LAN address. */
  mirrorOrigin: process.env.FILOW_PUBLIC_WEB || `http://${process.env.FILOW_LAN_IP || "127.0.0.1"}:${process.env.PORT || 4747}`,
  /** The address on this network, whatever the public link does: what the QR falls back to when the link goes away. */
  lanMirrorOrigin: `http://${process.env.FILOW_LAN_IP || "127.0.0.1"}:${process.env.PORT || 4747}`,
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
  /** The page says when a take starts and stops: the shell shows no "update ready" prompt meanwhile. */
  setTakeLive: (on) => ipcRenderer.send("take:live", Boolean(on)),
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
  /** Subscribe to the Offline menu toggle; returns the unsubscribe function (never the ipcRenderer object). */
  onOffline: (fn) => {
    const h = (_e, v) => fn(Boolean(v));
    ipcRenderer.on("offline", h);
    return () => ipcRenderer.removeListener("offline", h);
  },
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
  /** The points window for calls (points-window.js): open or close it, and hear when the menu does. */
  pointsWindow: {
    status: () => ipcRenderer.invoke("points:status"),
    set: (on) => ipcRenderer.invoke("points:set", on === true),
    onChange: (fn) => {
      const h = (_e, v) => fn(v);
      ipcRenderer.on("points:changed", h);
      return () => ipcRenderer.removeListener("points:changed", h);
    },
  },
  /** Streaming speech-to-text on this PC (sherpa-onnx + Nemotron in a worker thread of the shell). */
  stt: {
    status: () => ipcRenderer.invoke("stt:status"),
    download: (language, use) => ipcRenderer.send("stt:download", language, use),
    setLanguage: (language) => ipcRenderer.invoke("stt:language", language),
    remove: () => ipcRenderer.invoke("stt:remove"),
    start: (language) => ipcRenderer.invoke("stt:start", language),
    feed: (samples) => ipcRenderer.send("stt:feed", samples),
    stop: () => ipcRenderer.invoke("stt:stop"),
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
