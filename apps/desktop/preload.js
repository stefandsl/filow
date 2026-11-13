// Exposes desktop-only settings to the page. Nothing here is a secret the page
// does not already need: the LAN access password gates the spend endpoints
// against other devices on the Wi-Fi, and the page is the engine.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("filow", {
  desktop: true,
  account: {
    status: () => ipcRenderer.invoke("account:status"),
    configured: () => ipcRenderer.invoke("account:configured"),
    begin: () => ipcRenderer.invoke("account:begin"),
    poll: () => ipcRenderer.invoke("account:poll"),
    cancel: () => ipcRenderer.invoke("account:cancel"),
    signOut: () => ipcRenderer.invoke("account:signOut"),
    checkout: () => ipcRenderer.invoke("account:checkout"),
    portal: () => ipcRenderer.invoke("account:portal"),
  },
  tour: {
    mark: rect => ipcRenderer.invoke("tour:mark", rect),
    ask: lang => ipcRenderer.invoke("tour:ask", lang),
    done: () => ipcRenderer.invoke("tour:done"),
  },
  /** OK Filow's section in Filow Settings (same settings as its panel). */
  okFilow: {
    status: () => ipcRenderer.invoke("okfilow:settings:status"),
    configure: (patch) => ipcRenderer.invoke("okfilow:settings:configure", patch),
    openPanel: () => ipcRenderer.send("okfilow:settings:openPanel"),
    /** The "Whiteboard" button of the main window: opens the whiteboard window; false when OK Filow is not running. */
    showWhiteboard: () => ipcRenderer.invoke("okfilow:settings:showWhiteboard"),
    /** The "OK Filow" button of the main window: "open", "off" (switched off) or "unavailable" (not running). */
    openAsk: (at) => ipcRenderer.invoke("okfilow:settings:openAsk", at),
    /** A paired phone's question (useSession.ts), for OK Filow's panel: "asked", "off", "busy", "empty" or "unavailable". */
    askFromPhone: (text) => ipcRenderer.invoke("okfilow:settings:askFromPhone", text),
  },
  /** FreeLLMAPI's section in Filow Settings (freellm.js): the key goes in, never comes back. */
  freeLlm: {
    status: () => ipcRenderer.invoke("freellm:status"),
    configure: (patch) => ipcRenderer.invoke("freellm:configure", patch),
  },
  /** Dictation's section in Filow Settings (dictation.js). */
  dictation: {
    status: () => ipcRenderer.invoke("dictation:settings:status"),
    configure: (patch) => ipcRenderer.invoke("dictation:settings:configure", patch),
    downloadCleanup: () => ipcRenderer.invoke("dictation:cleanup:download"),
    downloadPunctuation: () => ipcRenderer.invoke("dictation:punctuation:download"),
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
  /** "Pair a phone" was opened: the shell brings the public link up now if the user has it on (it is not started at launch). */
  pairingOpened: () => ipcRenderer.send("remote:pairing"),
  remoteStatus: () => ipcRenderer.invoke("remote:status"),
  /** Auto-update state (installed app only): idle | checking | downloading | downloaded | none | error. */
  updateStatus: () => ipcRenderer.invoke("update:status"),
  /** Diagnostics: the page keeps the main process informed of its take log; "report" opens the local report window. */
  takeLog: (text) => ipcRenderer.send("diag:takeLog", text),
  reportProblem: () => ipcRenderer.send("diag:report"),
  openAbout: (view) => ipcRenderer.send("about:open", view === "report" ? "report" : "about"),
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
  /** Full screen hides the frame and the menu: the page's bar at the top leaves it, minimises or closes the main window (window-controls.js). */
  windowControls: {
    isFullScreen: () => ipcRenderer.invoke("window:isFullScreen"),
    exitFullScreen: () => ipcRenderer.send("window:exitFullScreen"),
    minimize: () => ipcRenderer.send("window:minimize"),
    close: () => ipcRenderer.send("window:close"),
    onFullScreen: (fn) => {
      const h = (_e, on) => fn(on === true);
      ipcRenderer.on("window:fullScreen", h);
      return () => ipcRenderer.removeListener("window:fullScreen", h);
    },
  },
  /** The shell is about to open a floating window (overlay, points window): it joins the session with a fresh pairing code (codes are single use). */
  onNeedCode: (fn) => {
    const h = () => fn();
    ipcRenderer.on("session:needCode", h);
    return () => ipcRenderer.removeListener("session:needCode", h);
  },
  /** A floating window joined the session and spent its code: the page puts a fresh one on screen. */
  codeSpent: () => ipcRenderer.send("session:codeSpent"),
  /** A floating window could not join (its code was spent, e.g. after a crash reload): the shell loads it again with a fresh one. */
  overlayRejoin: () => ipcRenderer.send("overlay:rejoin"),
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
  /**
   * The models in Filow's profile (model-control.js): what is on disk and in use, Stop for a download
   * ("speech", "voice", "cleanup", "punctuation", "ollama-installer", "cloudflared") and Delete for a
   * model ("speech:<key>", "voice", "cleanup", "punctuation").
   */
  /** This launch's proof that a request comes from Filow's own window (Settings > Advanced, model per task). */
  desktopToken: () => ipcRenderer.invoke("desktop:token"),
  models: {
    status: () => ipcRenderer.invoke("models:status"),
    cancel: (id) => ipcRenderer.invoke("models:cancel", id),
    remove: (id) => ipcRenderer.invoke("models:delete", id),
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
    /** Start an installed Ollama that is not running (the editor's local translation); nothing is downloaded. */
    start: () => ipcRenderer.send("localai:start"),
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
