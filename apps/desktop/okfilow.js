// OK Filow (docs/BUDDY-PLAN.md): push-to-talk screen helper ported from farzaa/clicky (MIT).
// Main-process side: one click-through overlay per display (the buddy dot, waveform, answer
// bubble, pointing), a small panel window that is also the "brain" (mic, speech-to-text, the
// /api/buddy/ask call, the voice), a tray icon, the hold-to-talk hotkey and the screenshots.
// Screenshots stay in memory; every OK Filow window is excluded from capture.
const { BrowserWindow, Tray, Menu, screen, desktopCapturer, ipcMain, globalShortcut, nativeImage, shell, systemPreferences } = require("electron");
const { keyboardPermission } = require("./mac-permissions");
const path = require("node:path");
const { createGestures, chordHeld } = require("./okfilow-gestures");
const { createAgents, agentTask, safeToOpen, pickCli } = require("./okfilow-agents");
const { createOutboundState, sanitizeConsent, applyConsentChanges, agentRecipient, agentGranted } = require("./okfilow-outbound");
const { readSelection } = require("./okfilow-selection");
const { answerRoot, defaultAnswerDir, writeAnswer, deleteAnswers } = require("./okfilow-answers");
const { trustedUiSender } = require("./ui-preferences");

/** An IPC event from the main frame of one of OK Filow's windows (`contents`), on an OK Filow page; never a subframe. */
function okfilowSender(event, contents, appUrl) {
  return trustedUiSender(event, { pages: contents, appUrl, pathPrefix: "/okfilow/" });
}

const DEFAULTS = {
  enabled: true,
  hotkey: "ctrl+alt",
  provider: "local",
  voice: "system",
  showAlways: false,
  // Dictation's switch lives in settings.dictation (dictation.js); an old okFilow.dictation: false is
  // still read there until the user changes a dictation setting.
  /** Buddy, drawing and highlighter colour (HeyClicky's cursor_color_hex). */
  color: "#ffb600",
  /** Speech rate for the voice, 0.75 to 1.5. */
  speed: 1,
  /** Typed questions answer silently unless this is on (HeyClicky: typed_turns_respond_with_voice). */
  typedVoice: false,
  /** Which coding agent runs "agent, ..." jobs: auto (Codex, else Claude Code), codex or claude. */
  agentCli: "auto",
  /** Set after the first-run welcome has played once. */
  onboarded: false,
  /** Send every monitor with each question (slower on a local model); default: only the one with the mouse. */
  allScreens: false,
  /** Let screenshots and recordings (and computer-use tools) see OK Filow's windows. Off: they stay private. */
  allowScreenshots: false,
  /** Answer log (question, raw text, visuals, screenshot per answer): opt-in, the only time a screenshot touches disk. */
  answerLog: false,
  /** Its folder; empty means "okfilow-answers" in the app's data folder (see defaultAnswerDir). */
  answerDir: "",
  /** What the user allowed or refused to send outside, per kind and recipient ("ask:openrouter/google"). */
  consent: {},
};
/** A finite point inside a window's or display's bounds (right and bottom edges excluded). */
const onRect = (x, y, b) => Number.isFinite(x) && Number.isFinite(y) && x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
/** Test builds only: FILOW_OKF_QA=1 lets screen recorders see OK Filow windows, for end-to-end checks. */
// Test switches work only in development or in a QA package (-c.extraMetadata.filowQa=true, see qa.js).
const QA_ALLOWED = require("./qa.js").isQaBuild(require("electron").app);
const QA_VISIBLE = QA_ALLOWED && process.env.FILOW_OKF_QA === "1";
const QA_SHOTS = QA_ALLOWED ? process.env.FILOW_OKF_QA_SHOTS || "" : "";
/** Test builds only: FILOW_OKF_QA_KEYS=1 lets the panel feed the gestures key presses (when Windows refuses the hook). */
const QA_KEYS = QA_ALLOWED && process.env.FILOW_OKF_QA_KEYS === "1";
/** The answer log's folder when the user has not picked one (okfilow-answers.js defaultAnswerDir). */
const answersFallback = () => defaultAnswerDir(require("electron").app.getPath("userData"), process.env, QA_ALLOWED);
const HOTKEYS = ["ctrl+alt", "ctrl+shift", "alt+shift", "ctrl+meta"];
// 1024 wide keeps buttons readable for the model and answers about twice as fast as 1280 on a local GPU.
const IMAGE_MAX_WIDTH = 1024;
const FADE_AFTER_MS = 1000;
/** Exactly the hotkey's modifiers are down (extra modifiers cancel, so Ctrl+Alt+Del never triggers it). */
const hotkeyHeld = chordHeld;

function createOkFilow(deps) {
  const { appUrl, getSettings, saveSettings, iconPath, logLine, sttLocal, userData, menuText, isOffline, askKeyboardPermission, dictation } = deps;
  const cfg = () => ({ ...DEFAULTS, ...(getSettings().okFilow || {}) });
  const setCfg = (patch) => {
    const { consentChanges, ...rest } = patch || {};
    const next = { ...cfg(), ...rest };
    // Windows send their consent changes, merged here into what is stored now (okfilow-outbound.js).
    if (consentChanges !== undefined) next.consent = applyConsentChanges(next.consent, consentChanges);
    if (!HOTKEYS.includes(next.hotkey)) next.hotkey = DEFAULTS.hotkey;
    if (next.provider !== "cloud") next.provider = "local";
    if (!["natural", "cloud", "off"].includes(next.voice)) next.voice = "system";
    // Until the user picks a voice, the natural one speaks as soon as its model is on this PC (status()).
    next.voiceChosen = next.voiceChosen === true || (!!patch && "voice" in patch);
    next.naturalVoice = Math.min(9, Math.max(0, Math.round(Number(next.naturalVoice)) || 0));
    if (!/^#[0-9a-f]{6}$/i.test(String(next.color))) next.color = DEFAULTS.color;
    next.speed = Math.min(1.5, Math.max(0.75, Number(next.speed) || 1));
    next.typedVoice = next.typedVoice === true;
    next.onboarded = next.onboarded === true;
    next.allScreens = next.allScreens === true;
    next.allowScreenshots = next.allowScreenshots === true;
    next.answerLog = next.answerLog === true;
    next.answerDir = typeof next.answerDir === "string" ? next.answerDir.slice(0, 500) : "";
    if (!["auto", "codex", "claude"].includes(next.agentCli)) next.agentCli = "auto";
    next.consent = sanitizeConsent(next.consent);
    saveSettings({ ...getSettings(), okFilow: next });
    return next;
  };

  /** displayId -> BrowserWindow */
  const overlays = new Map();
  /** True while the talk chord is held: the overlays take the mouse for the highlighter. */
  let mouseCaught = false;
  let panel = null;
  let tray = null;
  let mode = "idle"; // idle | listening | thinking | speaking | error
  let visible = false;
  let fadeTimer = null;
  let cursorTimer = null;
  let stt = null;
  let tts = null;
  let hook = null;
  let hookError = "";
  /** macOS only: the permission hold-to-talk still lacks (mac-permissions.js), "" when none. */
  let hookPermission = "";
  let held = false;

  const preload = path.join(__dirname, "okfilow-preload.js");
  /** Content protection keeps OK Filow out of screenshots and recordings unless the user allows them. */
  const hidden = () => !QA_VISIBLE && !cfg().allowScreenshots;
  const allWindows = () => [panel, modelWin, ...overlays.values()].filter((w) => w && !w.isDestroyed());
  const protectAll = (on) => { for (const w of allWindows()) w.setContentProtection(on); };
  /**
   * Our windows' main frames, still showing our own pages (they cannot navigate away, but check
   * anyway). Takes the IPC event, not event.sender: the frame that sent it is checked too.
   */
  const ourSender = (event) => okfilowSender(event, allWindows().map((w) => w.webContents), appUrl);
  /** Only a well-formed http(s) URL reaches the system browser (same rule as main.js openExternalSafe). */
  function openWeb(url) {
    let u;
    try { u = new URL(String(url)); } catch { return; }
    if (u.protocol === "https:" || u.protocol === "http:") void shell.openExternal(u.toString());
  }
  /** OK Filow windows never leave their page; links open in the system browser. */
  function lockDown(w) {
    w.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(`${appUrl}/okfilow/`)) { e.preventDefault(); openWeb(url); } });
    w.webContents.setWindowOpenHandler(({ url }) => {
      openWeb(url);
      return { action: "deny" };
    });
  }

  function sendPanel(channel, payload) {
    if (panel && !panel.isDestroyed()) panel.webContents.send(channel, payload);
  }
  function sendOverlays(channel, payload) {
    for (const w of overlays.values()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }

  // ---- going outside (okfilow-outbound.js, docs/okfilow/OUTBOUND.md) ----
  // While anything carrying the user's content is in flight, the overlays and the panel say so and
  // name who receives it. The overlays cannot fade while it is on.
  const outbound = createOutboundState({
    onChange: (snap) => {
      logLine(`okfilow: going outside ${snap.active ? `on (${snap.kinds.join("+")} to ${snap.names.join(", ")})` : "off"}`);
      sendOverlays("okfilow:outbound", snap);
      sendPanel("okfilow:outbound", snap);
      if (snap.active) {
        clearTimeout(fadeTimer);
        showOverlays();
        qaShot("outbound", 400);
      } else if (mode === "idle" || mode === "error") scheduleFade();
    },
  });
  ipcMain.on("okfilow:outbound:begin", (e, id, kind, names) => { if (ourSender(e)) outbound.begin(`web:${String(id)}`, kind, names); });
  ipcMain.on("okfilow:outbound:end", (e, id, opts) => { if (ourSender(e)) outbound.end(`web:${String(id)}`, { cancel: Boolean(opts && opts.cancel === true) }); });
  /** A first-send notice is open in the panel: it must be seen and must not vanish on a stray click. */
  let noticeOpen = false;
  let noticeShowedPanel = false;
  ipcMain.on("okfilow:notice:open", (e) => {
    if (!ourSender(e)) return;
    const p = buildPanel();
    if (!noticeOpen) noticeShowedPanel = !p.isVisible();
    noticeOpen = true;
    if (p.isVisible()) { p.moveTop(); p.focus(); } else showPanelAtCursor();
    logLine("okfilow: first-send notice shown");
  });
  ipcMain.on("okfilow:notice:close", (e) => {
    if (!ourSender(e) || !noticeOpen) return;
    noticeOpen = false;
    // Opened only for the notice: get out of the way of what the user is asking about.
    if (noticeShowedPanel && panel && !panel.isDestroyed()) panel.hide();
    noticeShowedPanel = false;
  });

  // ---- 3D model window (HeyClicky: a model you can drag around and click to ask about a part) ----
  let modelWin = null;
  let currentModel = null;
  function showModel(model) {
    currentModel = model;
    if (modelWin && !modelWin.isDestroyed()) {
      modelWin.webContents.send("okfilow:model", model);
      modelWin.showInactive();
      return;
    }
    const c = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(c).workArea;
    const w = 520;
    const h = 480;
    modelWin = new BrowserWindow({
      width: w,
      height: h,
      x: Math.round(Math.min(Math.max(wa.x + 8, c.x + 40), wa.x + wa.width - w - 8)),
      y: Math.round(Math.min(Math.max(wa.y + 8, c.y - h / 2), wa.y + wa.height - h - 8)),
      frame: false,
      transparent: true,
      resizable: true,
      minWidth: 320,
      minHeight: 300,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      title: "OK Filow 3D",
      backgroundColor: "#00000000",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload, backgroundThrottling: false },
    });
    modelWin.setContentProtection(hidden());
    lockDown(modelWin);
    modelWin.on("closed", () => { modelWin = null; });
    modelWin.once("ready-to-show", () => modelWin && !modelWin.isDestroyed() && modelWin.showInactive());
    modelWin.loadURL(`${appUrl}/okfilow/model`);
  }
  ipcMain.on("okfilow:model:show", (e, model) => { if (ourSender(e) && model && Array.isArray(model.parts)) showModel(model); });
  /** An overlay finished setting up: it missed what was sent while it loaded, so send it now. */
  ipcMain.on("okfilow:overlay:ready", (e) => {
    if (!ourSender(e)) return;
    e.sender.send("okfilow:state", { mode, purpose: purpose || "talk" });
    e.sender.send("okfilow:outbound", outbound.snapshot());
    lastCursor = "";
  });
  ipcMain.on("okfilow:panel:ready", (e) => { if (ourSender(e)) e.sender.send("okfilow:outbound", outbound.snapshot()); });
  ipcMain.on("okfilow:model:ready", (e) => {
    if (!ourSender(e) || !currentModel) return;
    e.sender.send("okfilow:model", currentModel);
    logLine(`okfilow: 3D model shown (${currentModel.parts.length} parts)`);
    qaShot("model", 3000);
  });
  ipcMain.on("okfilow:model:close", (e) => { if (ourSender(e) && modelWin && !modelWin.isDestroyed()) modelWin.close(); });
  ipcMain.on("okfilow:askAbout", (e, text) => { if (ourSender(e) && typeof text === "string") sendPanel("okfilow:askText", text.slice(0, 300)); });
  /** Cards (global DIP) go to the overlay of the display they sit on, in its local coordinates. */
  ipcMain.on("okfilow:cards", (e, list) => {
    if (!ourSender(e) || !Array.isArray(list)) return;
    pinned = true;
    showOverlays();
    for (const w of overlays.values()) {
      if (w.isDestroyed()) continue;
      const b = w.getBounds();
      const mine = list
        .filter((c) => c && onRect(c.x, c.y, b))
        .slice(0, 2)
        .map((c) => ({ x: c.x - b.x, y: c.y - b.y, title: String(c.title || "").slice(0, 60), text: String(c.text || "").slice(0, 240), photo: /^data:image\/(jpeg|png|webp|gif|svg\+xml);base64,/.test(String(c.photo || "")) ? String(c.photo) : "" }));
      w.webContents.send("okfilow:cards", mine);
    }
    qaShot("cards", 3500);
  });

  // ---- overlays ----
  function buildOverlays() {
    const displays = screen.getAllDisplays();
    const ids = new Set(displays.map((d) => d.id));
    for (const [id, w] of overlays) if (!ids.has(id)) { if (!w.isDestroyed()) w.destroy(); overlays.delete(id); }
    for (const d of displays) {
      let w = overlays.get(d.id);
      if (!w || w.isDestroyed()) {
        w = new BrowserWindow({
          ...d.bounds,
          frame: false,
          transparent: true,
          resizable: false,
          movable: false,
          focusable: false,
          skipTaskbar: true,
          hasShadow: false,
          show: false,
          // Cover the whole display, taskbar included: Windows otherwise fits a new window to the work
          // area, and points on the taskbar (the Start button) would land outside every overlay.
          enableLargerThanScreen: true,
          title: "OK Filow",
          backgroundColor: "#00000000",
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload, backgroundThrottling: false },
        });
        w.setIgnoreMouseEvents(!mouseCaught);
        w.setAlwaysOnTop(true, "screen-saver");
        w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        w.setContentProtection(hidden()); // out of the user's recordings unless they allow it
        lockDown(w);
        w.webContents.on("console-message", (e) => { if (e.level === "warning" || e.level === "error") logLine(`okfilow overlay ${e.level}: ${String(e.message).slice(0, 300)}`); });
        // A new overlay misses whatever was sent while it loaded: give it the state and the cursor now.
        w.webContents.on("did-finish-load", () => {
          if (w.isDestroyed()) return;
          w.webContents.send("okfilow:state", { mode, purpose: purpose || "talk" });
          w.webContents.send("okfilow:outbound", outbound.snapshot());
          lastCursor = "";
        });
        w.loadURL(`${appUrl}/okfilow/overlay`);
        overlays.set(d.id, w);
      } else {
        w.setBounds(d.bounds);
      }
    }
  }

  function showOverlays() {
    if (visible) return;
    visible = true;
    buildOverlays();
    for (const [id, w] of overlays) {
      if (w.isDestroyed()) continue;
      w.showInactive();
      const d = screen.getAllDisplays().find((x) => x.id === id);
      if (d) w.setBounds(d.bounds); // after showing: Windows shrinks hidden windows to the work area
      w.setIgnoreMouseEvents(!mouseCaught);
    }
    startCursor();
  }
  function hideOverlays() {
    if (!visible) return;
    visible = false;
    stopCursor();
    for (const w of overlays.values()) if (!w.isDestroyed()) w.hide();
  }
  /** An answer's visuals (points, marks, cards, drawings) stay up until Escape, the panel's Clear or the next question. */
  let pinned = false;
  /** `ms`: how long the bubble stays after the end (a dictation that was only copied says so for longer). */
  function scheduleFade(ms = FADE_AFTER_MS) {
    clearTimeout(fadeTimer);
    if (cfg().showAlways || pinned || outbound.active()) return;
    fadeTimer = setTimeout(() => {
      if (!pinned && !outbound.active() && (mode === "idle" || mode === "error")) hideOverlays();
    }, Math.min(Math.max(Number(ms) || FADE_AFTER_MS, FADE_AFTER_MS), 6000));
  }

  let lastCursor = "";
  function startCursor() {
    if (cursorTimer) return;
    cursorTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      const d = screen.getDisplayNearestPoint(p);
      const key = `${d.id}:${p.x}:${p.y}`;
      if (key === lastCursor) return;
      lastCursor = key;
      for (const [id, w] of overlays) {
        if (w.isDestroyed()) continue;
        const b = w.getBounds();
        w.webContents.send("okfilow:cursor", id === d.id ? { x: p.x - b.x, y: p.y - b.y } : null);
      }
    }, 16);
  }
  function stopCursor() {
    clearInterval(cursorTimer);
    cursorTimer = null;
    lastCursor = "";
  }

  // ---- state ----
  function setMode(next, extra = {}) {
    // The panel could not start listening (no model, microphone refused) while keys are still counted as
    // held: end that session here, or a toggle-mode dictation would eat the user's next press as "stop".
    if (next === "error" && held) {
      held = false;
      clearTimeout(dictateCap);
      if (purpose === "dictate") gestures?.endToggle();
      setOverlayMouse(false);
      purpose = null;
    }
    mode = next;
    sendOverlays("okfilow:state", { mode, ...extra });
    sendPanel("okfilow:mode", { mode, ...extra });
    if (mode !== "idle" && mode !== "error") {
      clearTimeout(fadeTimer);
      showOverlays();
    } else scheduleFade(extra.holdMs);
  }

  // ---- panel (also the brain) ----
  function buildPanel() {
    if (panel && !panel.isDestroyed()) return panel;
    panel = new BrowserWindow({
      width: 380,
      height: 520,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "OK Filow",
      backgroundColor: "#121212",
      icon: iconPath,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload, backgroundThrottling: false },
    });
    panel.setContentProtection(hidden());
    panel.on("blur", () => panel && !panel.isDestroyed() && !noticeOpen && panel.hide());
    panel.on("closed", () => { panel = null; noticeOpen = false; outbound.clear("web:"); });
    // A panel that crashed or reloaded can no longer end its sends: they are over.
    panel.webContents.on("render-process-gone", () => { noticeOpen = false; outbound.clear("web:"); });
    panel.webContents.on("did-start-loading", () => { noticeOpen = false; outbound.clear("web:"); });
    panel.webContents.on("console-message", (e) => { if (e.level === "warning" || e.level === "error") logLine(`okfilow panel ${e.level}: ${String(e.message).slice(0, 300)}`); });
    lockDown(panel);
    panel.loadURL(`${appUrl}/okfilow/panel`);
    return panel;
  }
  function togglePanel() {
    const p = buildPanel();
    if (p.isVisible()) return p.hide();
    const at = tray ? tray.getBounds() : null;
    const wa = screen.getDisplayNearestPoint(at ? { x: at.x, y: at.y } : screen.getCursorScreenPoint()).workArea;
    const [w, h] = p.getSize();
    const x = Math.min(Math.max(wa.x, (at ? at.x + at.width / 2 : wa.x + wa.width) - w / 2), wa.x + wa.width - w - 8);
    const y = at && at.y < wa.y + wa.height / 2 ? wa.y + 8 : wa.y + wa.height - h - 8;
    p.setPosition(Math.round(x), Math.round(y));
    p.show();
    p.focus();
  }

  function buildTray() {
    if (tray) return;
    try {
      const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
      tray = new Tray(img);
      tray.setToolTip("OK Filow");
      tray.on("click", togglePanel);
      refreshTray();
    } catch (e) {
      logLine(`okfilow tray: ${e && e.message}`);
    }
  }
  function refreshTray() {
    if (!tray) return;
    const c = cfg();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: menuText("okfOpen"), click: togglePanel },
        { label: menuText("okfShowAlways"), type: "checkbox", checked: c.showAlways, click: (i) => applyConfig({ showAlways: i.checked }) },
        { label: menuText("okfEnabled"), type: "checkbox", checked: c.enabled, click: (i) => applyConfig({ enabled: i.checked }) },
      ]),
    );
  }

  function applyConfig(patch) {
    // The panel's dictation switch writes dictation.js's setting (it used to live in okFilow.dictation).
    const { dictation: dictationOn, ...rest } = patch || {};
    if (typeof dictationOn === "boolean") dictation.configure({ enabled: dictationOn });
    const c = setCfg(rest);
    protectAll(hidden());
    if (c.showAlways && c.enabled) showOverlays();
    else if (mode === "idle" && !outbound.active()) hideOverlays();
    if (!c.enabled && mode === "listening") release();
    if (!c.enabled && handsFree) { handsFree = false; sendPanel("okfilow:handsfree", false); }
    refreshTray();
    sendPanel("okfilow:config", status());
    sendOverlays("okfilow:config", status());
    return status();
  }

  /** Test builds only: FILOW_OKF_QA_SHOTS=<dir> saves each overlay as PNG once a drawing has played. */
  function qaShot(tag, delayMs = 4500) {
    const dir = QA_SHOTS;
    if (!dir) return;
    setTimeout(async () => {
      const wins = [...overlays.entries()];
      if (modelWin && !modelWin.isDestroyed()) wins.push(["model", modelWin]);
      for (const [id, w] of wins) {
        if (w.isDestroyed()) continue;
        try {
          const dom = await w.webContents.executeJavaScript("JSON.stringify({bridge: typeof window.okFilow, fns: Object.keys(window.okFilow || {}).length, onState: typeof window.okFilow?.onState, onStrokes: typeof window.okFilow?.onStrokes, react: Object.keys(document.querySelector('.okf-overlay') || {}).filter((k) => k.startsWith('__react')).length, url: location.href, buddy: document.querySelector('.okf-buddy')?.className, at: document.querySelector('.okf-buddy')?.style.transform, label: document.querySelector('.okf-label')?.textContent || '', marks: document.querySelectorAll('.okf-mark').length, ink: document.querySelectorAll('.okf-ink polyline').length, bubble: document.querySelector('.okf-bubble')?.className, vis: document.visibilityState})");
          logLine(`okfilow qa overlay ${id} visible=${w.isVisible()} ${dom}`);
          const img = await w.webContents.capturePage();
          require("node:fs").mkdirSync(dir, { recursive: true });
          require("node:fs").writeFileSync(path.join(dir, `${tag}-${id}-${Date.now()}.png`), img.toPNG());
        } catch (e) { logLine(`okfilow qa shot: ${e.message}`); }
      }
    }, delayMs);
  }
  /** Shifts a mark to an overlay's local coordinates, or null when its anchor is on another display. */
  function localMark(m, b) {
    const n = (v) => (Number.isFinite(v) ? v : NaN);
    const ax = n(m.kind === "circle" ? m.x : m.x1);
    const ay = n(m.kind === "circle" || m.kind === "underline" ? m.y : m.y1);
    if (!onRect(ax, ay, b)) return null;
    const label = String(m.label || "").slice(0, 60);
    switch (m.kind) {
      case "circle": return { kind: "circle", x: m.x - b.x, y: m.y - b.y, r: Math.max(6, Math.min(600, n(m.r))), label };
      case "underline": return { kind: "underline", x1: m.x1 - b.x, y: m.y - b.y, x2: n(m.x2) - b.x, label };
      case "arrow": case "box": return { kind: m.kind, x1: m.x1 - b.x, y1: m.y1 - b.y, x2: n(m.x2) - b.x, y2: n(m.y2) - b.y, label };
      default: return null;
    }
  }
  // Not on any click or key: the user clicks around and presses Win+Shift+S to screenshot the answer.
  function clearDrawings() {
    if (!pinned) return;
    pinned = false;
    sendOverlays("okfilow:clear", null);
    if (mode === "idle" || mode === "error") scheduleFade();
  }

  // ---- keyboard gestures (okfilow-gestures.js) ----
  // Hold the talk chord to ask; hold the dictation chord (dictation.js, default Ctrl+Win) to dictate into
  // the focused app; tap it twice for hands-free; tap Ctrl twice for the text box. While talking, the
  // mouse draws a highlighter stroke on the overlay (the overlay takes the mouse only for that time) and
  // the model sees what was marked.
  let gestures = null;
  let purpose = null; // "talk" | "dictate" while the mic is open from a hold
  let handsFree = false;
  let strokes = []; // [{ displayId, points: [[x, y] global DIP] }]
  let selection = Promise.resolve(""); // text selected in the focused app when the talk began
  let dictateCap = null;
  let releasedAt = 0; // when the last dictation's keys went up, for the release-to-text log line

  function press(kind = "talk") {
    // Dictation has its own switch: it works with OK Filow's questions turned off.
    if (held || !(kind === "dictate" ? dictation.cfg().enabled : cfg().enabled)) return;
    held = true;
    purpose = kind;
    // A toggle-mode dictation nobody stops ends by itself after five minutes.
    clearTimeout(dictateCap);
    if (kind === "dictate") dictateCap = setTimeout(() => purpose === "dictate" && release(), 5 * 60_000);
    // Read the selection while the user's app still has focus; it goes with the question.
    if (kind === "talk") { clearDrawings(); strokes = []; setOverlayMouse(true); selection = readSelection(); }
    sendPanel("okfilow:press", { purpose: kind });
  }
  function release() {
    if (!held) return;
    held = false;
    clearTimeout(dictateCap);
    if (purpose === "dictate") { releasedAt = Date.now(); gestures?.endToggle(); }
    setOverlayMouse(false);
    sendPanel("okfilow:release", { purpose });
    purpose = null;
  }
  function cancel() {
    if (!held) return;
    held = false;
    clearTimeout(dictateCap);
    if (purpose === "dictate") gestures?.endToggle();
    setOverlayMouse(false);
    strokes = [];
    sendOverlays("okfilow:strokes", []);
    sendPanel("okfilow:cancel", { purpose });
    purpose = null;
  }
  /** The overlays catch the mouse only while the talk chord is held, so a drag marks instead of clicking. */
  function setOverlayMouse(capture) {
    // Remembered: overlays created or shown later (the first press creates them) must get it too.
    mouseCaught = capture;
    for (const w of overlays.values()) if (!w.isDestroyed()) w.setIgnoreMouseEvents(!capture);
    if (QA_SHOTS) logLine(`okfilow qa mouse ${capture ? "caught" : "through"} on ${overlays.size} overlay(s), visible=${visible}`);
  }
  function onGesture(ev) {
    logLine(`okfilow: gesture ${ev}`);
    switch (ev) {
      case "talk:start": return press("talk");
      case "dictate:start": return press("dictate");
      case "talk:end": case "dictate:end": return release();
      case "talk:cancel": case "dictate:cancel": return cancel();
      case "handsfree:toggle":
        if (!cfg().enabled) return;
        handsFree = !handsFree;
        logLine(`okfilow: hands-free ${handsFree ? "on" : "off"}`);
        return sendPanel("okfilow:handsfree", handsFree);
      case "text:open":
        if (!cfg().enabled) return;
        return openQuickAsk();
    }
  }
  /** Waits until every modifier is up, so a synthetic Ctrl+V never becomes Win+V or Ctrl+Alt+V. */
  async function modifiersUp(timeoutMs = 2000) {
    const until = Date.now() + timeoutMs;
    while (gestures && gestures.anyDown && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
    return !(gestures && gestures.anyDown);
  }
  /**
   * Dictated text from the panel: typed into whatever has focus (dictation.js decides how: directly in
   * Filow's own windows, else clipboard + paste with the user's clipboard put back, or only copied).
   */
  async function typeText(text, spokenLanguage) {
    // QA key mode: the paste still goes out through uiohook (SendInput), which works without the hook.
    const keys = hook || (QA_KEYS ? require("uiohook-napi").uIOhook : null);
    const r = await dictation.insert(text, { hook: keys, keysUp: () => modifiersUp(), spokenLanguage });
    if (releasedAt && r.action !== "none") logLine(`dictation: release to text ${Date.now() - releasedAt} ms (${r.action}${r.reason ? `, ${r.reason}` : ""})`);
    releasedAt = 0;
    return r;
  }
  function openQuickAsk() {
    showPanelAtCursor();
    sendPanel("okfilow:quickAsk", null);
  }
  /** Shows the panel next to the mouse and gives it the keyboard. */
  function showPanelAtCursor() {
    const p = buildPanel();
    const c = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(c).workArea;
    const [w, h] = p.getSize();
    p.setPosition(Math.round(Math.min(Math.max(wa.x + 8, c.x + 14), wa.x + wa.width - w - 8)), Math.round(Math.min(Math.max(wa.y + 8, c.y + 18), wa.y + wa.height - h - 8)));
    // Windows only lets the process that sent the last input take the foreground: a tap of F24
    // (a key no app uses) from our hook makes that us, so the box really gets the keyboard.
    try { if (hook) hook.keyTap(require("uiohook-napi").UiohookKey.F24); } catch { /* focus may stay put */ }
    p.show();
    p.moveTop();
    p.focus();
    p.webContents.focus();
  }

  let hookAttempts = 0;
  function startHook() {
    try {
      // macOS: no hook before the permission is there (mac-permissions.js); the toggle below works meanwhile.
      const missing = keyboardPermission({ platform: process.platform, systemPreferences });
      if (missing) throw Object.assign(new Error(`macOS has not allowed reading the keyboard yet (${missing})`), { permission: missing });
      const { uIOhook, UiohookKey: K } = require("uiohook-napi");
      const map = {
        [K.Ctrl]: "ctrl", [K.CtrlRight]: "ctrl",
        [K.Alt]: "alt", [K.AltRight]: "alt",
        [K.Shift]: "shift", [K.ShiftRight]: "shift",
        [K.Meta]: "meta", [K.MetaRight]: "meta",
      };
      // Made once: a retry (Windows refused the hook) must not swap it for a fresh one while a chord is
      // down or a dictation runs, or the key-ups go to the new one and the old session never ends.
      // Listeners from a failed attempt are dropped so a retry does not add a second set.
      uIOhook.removeAllListeners();
      if (!gestures) gestures = createGestures({
        talk: () => cfg().hotkey,
        // Null while dictation is off or its keys clash with the talk keys (Settings says so).
        dictate: () => dictation.activeChord(cfg().hotkey),
        dictateMode: () => dictation.cfg().mode,
        emit: onGesture,
      });
      uIOhook.on("keydown", (e) => {
        // Windows injects a keycode-0 "mask" key while Win is held (so Start does not open): not a key press.
        if (!e.keycode) return;
        const k = map[e.keycode] || null;
        gestures.keydown(k);
        if (e.keycode === K.Escape) { clearDrawings(); gestures.escape(); }
      });
      uIOhook.on("keyup", (e) => { if (e.keycode) gestures.keyup(map[e.keycode] || null); });
      // Key-ups on the secure desktop (Win+L, Ctrl+Alt+Del, sleep) never reach the hook: start clean
      // after them. (The modifier flags on hook events are not reliable on Windows: Alt reads false.)
      // Once only: a failed start is retried (every 2 s, then every 30 s) and must not add listeners each time.
      if (!powerWired) {
        powerWired = true;
        const { powerMonitor } = require("electron");
        for (const ev of ["lock-screen", "unlock-screen", "suspend", "resume"]) powerMonitor.on(ev, () => gestures.reset());
      }
      uIOhook.on("mousedown", () => {
        gestures.mousedown();
      });
      uIOhook.start();
      hook = uIOhook;
      hookError = "";
      hookPermission = "";
      clearTimeout(hookRetryTimer);
      try { globalShortcut.unregister("CommandOrControl+Alt+O"); } catch { /* was not registered */ }
      retryingQuietly = false;
      logLine("okfilow: hold-to-talk hook started");
      sendPanel("okfilow:config", status());
    } catch (e) {
      // A start that failed leaves its key listeners on the hook: drop them before any retry adds new ones.
      try { require("uiohook-napi").uIOhook.removeAllListeners(); } catch { /* nothing attached */ }
      hookError = String((e && e.message) || e);
      hookPermission = (e && e.permission) || keyboardPermission({ platform: process.platform, systemPreferences, error: e }) || "";
      if (hookPermission && askKeyboardPermission) void askKeyboardPermission(hookPermission);
      // Windows can refuse the hook for a moment (another app just let go of one): try again first.
      hookAttempts += 1;
      if (!retryingQuietly && hookAttempts < 5 && /register|hook/i.test(hookError)) {
        logLine(`okfilow: keyboard hook not ready (${hookError}), retry ${hookAttempts} of 4`);
        setTimeout(startHook, 2000);
        return;
      }
      if (!retryingQuietly) logLine(`okfilow: keyboard hook unavailable (${hookError}); falling back to Ctrl+Alt+O toggle`);
      try {
        if (!globalShortcut.isRegistered("CommandOrControl+Alt+O")) {
          globalShortcut.register("CommandOrControl+Alt+O", () => {
            if (held) return release();
            held = true;
            sendPanel("okfilow:press");
          });
        }
      } catch { /* the main hotkey code owns errors */ }
      // Keep trying in the background: hold-to-talk comes back as soon as Windows allows the hook.
      clearTimeout(hookRetryTimer);
      hookRetryTimer = setTimeout(() => {
        hookAttempts = 0;
        retryingQuietly = true;
        startHook();
      }, 30_000);
    }
  }
  let hookRetryTimer = null;
  let powerWired = false;
  let retryingQuietly = false;

  // ---- screenshots ----
  async function capture() {
    const displays = screen.getAllDisplays();
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)));
    const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)));
    if (!hidden()) protectAll(true); // the model never sees OK Filow itself
    let sources;
    try {
      sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.min(maxW, 2560), height: Math.min(maxH, 2560) } });
    } finally {
      if (!hidden()) protectAll(false);
    }
    const selected = await Promise.race([selection, new Promise((r) => setTimeout(() => r(""), 1200))]);
    selection = Promise.resolve("");
    const out = { images: [], screens: [], displays: [], marked: [], selected };
    // Cursor display first: the model weighs the first image most.
    // Only the screen with the mouse, like HeyClicky: one image instead of one per monitor halves the
    // time a local model needs. Other screens are added only when the setting asks for them.
    const ordered = (cfg().allScreens ? [cursor, ...displays.filter((d) => d.id !== cursor.id)] : [cursor]).slice(0, 4);
    ordered.forEach((d) => {
      const src = sources.find((s) => String(s.display_id) === String(d.id)) || (displays.length === 1 ? sources[0] : null);
      if (!src || src.thumbnail.isEmpty()) return;
      let img = src.thumbnail;
      const size = img.getSize();
      if (size.width > IMAGE_MAX_WIDTH) img = img.resize({ width: IMAGE_MAX_WIDTH, quality: "good" });
      const { width, height } = img.getSize();
      const index = out.images.length + 1;
      out.images.push(`data:image/jpeg;base64,${img.toJPEG(72).toString("base64")}`);
      out.screens.push({ index, width, height, cursor: d.id === cursor.id });
      out.displays.push({ index, id: d.id, bounds: d.bounds });
      // What the user circled while asking, on the 0-1000 grid of this screen.
      for (const st of strokes.filter((x) => x.displayId === d.id)) {
        out.marked.push({
          screen: index,
          points: st.points.map(([x, y]) => [Math.round(((x - d.bounds.x) / d.bounds.width) * 1000), Math.round(((y - d.bounds.y) / d.bounds.height) * 1000)]),
        });
      }
    });
    strokes = [];
    if (!out.images.length) throw new Error(menuText("okfNoCapture"));
    return out;
  }

  function status() {
    const c = cfg();
    if (!c.voiceChosen && c.voice === "system" && tts?.usable()) c.voice = "natural";
    // Dictation keeps its own settings (dictation.js); the panel shows its switch and keys from here.
    const d = dictation.status({ talkHotkey: c.hotkey, hook: Boolean(hook) });
    // answerDir: the folder the log writes to, also when the user has not picked one (the panel shows its name).
    return { ...c, answerDir: answerRoot(c.answerDir, answersFallback()), hotkeys: HOTKEYS, offline: isOffline(), hook: hook ? "hold" : "toggle", hookError, hookPermission, mode, handsFree, dictation: d.enabled, dictateChord: d.chord, dictationStatus: d };
  }

  // ---- IPC (only OK Filow's own windows) ----
  function guard(handler) {
    return (event, ...args) => {
      if (!ourSender(event)) throw new Error("Denied");
      return handler(...args);
    };
  }
  ipcMain.handle("okfilow:status", guard(() => status()));
  ipcMain.handle("okfilow:configure", guard((patch) => applyConfig(patch && typeof patch === "object" ? patch : {})));
  ipcMain.handle("okfilow:capture", guard(async () => {
    const t = Date.now();
    const out = await capture();
    logLine(`okfilow: captured ${out.images.length} screen(s) in ${Date.now() - t} ms`);
    return out;
  }));
  ipcMain.handle("okfilow:setMode", guard((m, extra) => (logLine(`okfilow: mode ${m}${extra && extra.error ? ` (${String(extra.error).slice(0, 200)})` : ""}`), setMode(typeof m === "string" ? m : "idle", extra && typeof extra === "object" ? extra : {}))));
  ipcMain.on("okfilow:level", (e, level) => ourSender(e) && sendOverlays("okfilow:level", Number(level) || 0));
  let lastQaText = "";
  ipcMain.on("okfilow:text", (e, text) => {
    if (!ourSender(e)) return;
    const t = String(text || "").slice(0, 2000);
    sendOverlays("okfilow:text", t);
    // Test builds log what the bubble shows, so end-to-end runs can be checked from the log.
    if (QA_SHOTS && t && t !== lastQaText) { lastQaText = t; clearTimeout(qaTextTimer); qaTextTimer = setTimeout(() => logLine(`okfilow qa text: ${lastQaText.slice(0, 300)}`), 1500); }
  });
  let qaTextTimer = null;
  /** The panel's Clear button, and every new typed question. */
  ipcMain.on("okfilow:clearVisuals", (e) => ourSender(e) && clearDrawings());
  let lastAnswerDir = "";
  ipcMain.handle("okfilow:answerLog", guard((entry) => {
    const root = cfg().answerLog ? answerRoot(cfg().answerDir, answersFallback()) : "";
    if (!root || !entry || typeof entry !== "object") return "";
    lastAnswerDir = writeAnswer(root, entry);
    logLine(`okfilow: answer saved to ${lastAnswerDir}`);
    return lastAnswerDir;
  }));
  ipcMain.handle("okfilow:pickAnswerDir", guard(async () => {
    const { dialog } = require("electron");
    const r = await dialog.showOpenDialog(panel && !panel.isDestroyed() ? panel : undefined, { properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return status();
    return applyConfig({ answerDir: r.filePaths[0] });
  }));
  ipcMain.handle("okfilow:deleteAnswers", guard(() => {
    const n = deleteAnswers(answerRoot(cfg().answerDir, answersFallback()));
    lastAnswerDir = "";
    logLine(`okfilow: deleted ${n} saved answer(s)`);
    return n;
  }));
  ipcMain.handle("okfilow:openAnswers", guard(async () => {
    const dir = lastAnswerDir || answerRoot(cfg().answerDir, answersFallback());
    const fs = require("node:fs");
    // With the log off, an answer folder that was never written is not created just to be shown.
    if (!dir || (!cfg().answerLog && !fs.existsSync(dir))) return false;
    fs.mkdirSync(dir, { recursive: true });
    return (await shell.openPath(dir)) === "";
  }));
  ipcMain.on("okfilow:hidePanel", (e) => ourSender(e) && panel && !panel.isDestroyed() && panel.hide());
  ipcMain.on("okfilow:press", (e) => ourSender(e) && press("talk"));
  ipcMain.on("okfilow:release", (e) => ourSender(e) && release());
  /** Dictation result from the panel: typed into whatever app has focus. */
  ipcMain.handle("okfilow:typeText", guard((text, lang) => typeText(typeof text === "string" ? text.slice(0, 20000) : "", typeof lang === "string" ? lang.slice(0, 5) : "")));
  /** Test builds only (FILOW_OKF_QA_KEYS=1): key presses for the gestures, as the hook would deliver them. */
  ipcMain.on("okfilow:qa:key", (e, type, key) => {
    if (!QA_KEYS || !ourSender(e) || !gestures) return;
    const mod = ["ctrl", "alt", "shift", "meta"].includes(key) ? key : null;
    if (type === "down") { gestures.keydown(mod); if (key === "escape") gestures.escape(); }
    else if (type === "up") gestures.keyup(mod);
  });
  /** Hands-free off from the panel (its button or Escape). */
  ipcMain.on("okfilow:handsfreeOff", (e) => { if (ourSender(e)) { handsFree = false; sendPanel("okfilow:handsfree", false); } });
  /** Highlighter strokes from an overlay, in its local coordinates; kept in global DIP until the question is sent. */
  ipcMain.on("okfilow:stroke", (e, points) => {
    if (!ourSender(e) || !held || purpose !== "talk" || !Array.isArray(points)) return;
    const entry = [...overlays.entries()].find(([, w]) => !w.isDestroyed() && w.webContents === e.sender);
    if (!entry) return;
    const b = entry[1].getBounds();
    const pts = points.slice(0, 400).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([x, y]) => [x + b.x, y + b.y]);
    if (pts.length > 1) { strokes.push({ displayId: entry[0], points: pts }); qaShot("stroke", 50); }
    if (strokes.length > 6) strokes.shift();
  });
  /** points: [{x, y, label, display: {id, bounds}, image: {width, height}}] already mapped to global DIP by the panel. */
  ipcMain.on("okfilow:point", (e, points) => {
    if (!ourSender(e) || !Array.isArray(points)) return;
    pinned = true;
    qaShot("point", 2500);
    if (QA_SHOTS) {
      logLine(`okfilow qa points ${JSON.stringify(points)} overlays ${JSON.stringify([...overlays.entries()].map(([id, w]) => [id, w.getBounds()]))} displays ${JSON.stringify(screen.getAllDisplays().map((d) => [d.id, d.bounds]))}`);
    }
    showOverlays();
    for (const w of overlays.values()) {
      if (w.isDestroyed()) continue;
      const b = w.getBounds();
      const mine = points
        .filter((p) => p && onRect(p.x, p.y, b))
        .map((p) => ({ x: p.x - b.x, y: p.y - b.y, label: String(p.label || "").slice(0, 60) }));
      w.webContents.send("okfilow:point", mine);
    }
  });

  /** marks: BuddyMark[] in global DIP. Each overlay gets the ones anchored on its display, in local coordinates. */
  ipcMain.on("okfilow:draw", (e, marks) => {
    if (!ourSender(e) || !Array.isArray(marks)) return;
    pinned = true;
    showOverlays();
    qaShot("draw");
    for (const w of overlays.values()) {
      if (w.isDestroyed()) continue;
      const b = w.getBounds();
      const mine = marks.filter((m) => m && typeof m === "object").map((m) => localMark(m, b)).filter(Boolean);
      w.webContents.send("okfilow:draw", mine);
    }
  });

  // Speech-to-text on this PC: its own sherpa session, so it never steals the presenter's.
  ipcMain.handle("okfilow:stt:status", guard(() => ({ ready: sttLocal.modelReady(userData) })));
  ipcMain.handle("okfilow:stt:start", async (event, language) => {
    if (!ourSender(event)) throw new Error("Denied");
    // First use on a clean PC: start the download instead of only refusing.
    if (!sttLocal.modelReady(userData)) { deps.sttDownload?.(); throw new Error(menuText("okfNoStt")); }
    if (!stt) stt = new sttLocal.SttSession(userData, logLine);
    const wc = event.sender;
    stt.onResult = (r) => !wc.isDestroyed() && wc.send("okfilow:stt:result", { partial: r.partial, committed: r.committed });
    stt.onError = (m) => !wc.isDestroyed() && wc.send("okfilow:stt:result", { partial: "", committed: "", error: m });
    return stt.start(typeof language === "string" ? language : "auto");
  });
  ipcMain.on("okfilow:stt:feed", (e, samples) => {
    if (ourSender(e) && stt) stt.feed(samples instanceof Float32Array ? samples : new Float32Array(samples));
  });
  ipcMain.handle("okfilow:stt:stop", guard(() => stt?.stop()));

  // The natural voice on this PC (tts.js, docs/okfilow/VOICE.md). A model that arrives or leaves
  // changes which voice speaks by default, so the windows get the new config.
  tts = require("./tts").wireTts({
    ipcMain, ours: ourSender, userData, logLine, isOffline,
    qaDir: QA_ALLOWED ? process.env.FILOW_OKF_QA_TTS_DIR || "" : "",
    onChange: () => { sendPanel("okfilow:config", status()); sendOverlays("okfilow:config", status()); },
  });

  // ---- agents (okfilow-agents.js): "agent, <task>" runs a background job ----
  // Only hits are cached: a CLI installed while Filow runs is found on the next try.
  const found = new Set();
  const which = (name) => {
    if (!found.has(name) && require("node:child_process").spawnSync(process.platform === "win32" ? "where" : "which", [name], { windowsHide: true }).status === 0) found.add(name);
    return found.has(name);
  };
  const agentsDir = process.env.FILOW_AGENTS_DIR || path.join(userData, "okfilow-agents");
  /** Ids of the running jobs the going-outside signal is on for. */
  const agentsOut = new Set();
  const agents = createAgents({
    baseDir: agentsDir,
    logLine,
    onChange: (jobs) => { sendPanel("okfilow:jobs", jobs); trackAgents(jobs); },
    cli: () => cfg().agentCli,
    which,
    openPath: (p) => { void shell.openPath(p); },
    showItem: (p) => shell.showItemInFolder(p),
    announce: (job) => sendPanel("okfilow:jobDone", job),
  });
  /** Only paths inside the agents folder may be opened from the panel. */
  const insideAgents = (p) => {
    const rel = path.relative(agentsDir, path.resolve(String(p || "")));
    return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  /** A running agent talks to its maker for as long as it runs: the going-outside signal follows the job. */
  function trackAgents(jobs) {
    const running = new Set();
    for (const job of jobs) {
      const to = job.status === "running" ? agentRecipient(job.cli) : null;
      if (!to) continue;
      running.add(job.id);
      if (!agentsOut.has(job.id)) { agentsOut.add(job.id); outbound.begin(`agent:${job.id}`, "agent", to.names); }
    }
    for (const id of [...agentsOut]) if (!running.has(id)) { agentsOut.delete(id); outbound.end(`agent:${id}`); }
  }
  /**
   * Returns the started job, null when the text is not an "agent, ..." request, or { needsConsent }
   * when the user has not yet said yes to the maker of the CLI that would run it: nothing is started.
   */
  ipcMain.handle("okfilow:agent:start", guard((text, context) => {
    const task = agentTask(text);
    if (!task) return null;
    const cli = pickCli(cfg().agentCli, which);
    const to = agentRecipient(cli);
    // No CLI at all: agents.start says so itself, and nothing leaves.
    if (to && !agentGranted(cfg().consent, cli)) return { needsConsent: { kind: "agent", recipient: { id: to.id, names: to.names }, cli: to.cli } };
    return agents.start(task, typeof context === "string" ? context.slice(0, 2000) : "");
  }));
  ipcMain.handle("okfilow:agent:list", guard(() => agents.list()));
  ipcMain.handle("okfilow:agent:stop", guard((id) => agents.stop(String(id))));
  ipcMain.handle("okfilow:agent:remove", guard((id) => agents.remove(String(id))));
  /** Folders and documents open; anything that could run is only shown in Explorer. */
  ipcMain.handle("okfilow:agent:open", guard((p) => {
    if (!insideAgents(p)) return "Denied";
    const full = path.resolve(p);
    const fs = require("node:fs");
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return shell.openPath(full);
    if (safeToOpen(full)) return shell.openPath(full);
    shell.showItemInFolder(full);
    return "";
  }));

  // ---- lifecycle ----
  function start() {
    buildTray();
    buildPanel();
    startHook();
    // Dictation turned off, or its keys changed, while it records: stop without typing.
    dictation.onChange((d) => {
      if (purpose === "dictate" && (!d.enabled || !dictation.activeChord(cfg().hotkey))) cancel();
      sendPanel("okfilow:config", status());
    });
    screen.on("display-added", () => visible && buildOverlays());
    screen.on("display-removed", () => buildOverlays());
    screen.on("display-metrics-changed", () => buildOverlays());
    if (cfg().enabled && cfg().showAlways) showOverlays();
    // First run: the panel says hello and circles the tray icon, once (HeyClicky's intro).
    if (cfg().enabled && !cfg().onboarded) {
      setTimeout(() => {
        const b = tray && !tray.isDestroyed?.() ? tray.getBounds() : null;
        sendPanel("okfilow:welcome", b && b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null);
      }, 4000);
    }
  }
  function dispose() {
    try { agents.dispose(); } catch { /* quitting */ }
    outbound.clear();
    if (modelWin && !modelWin.isDestroyed()) modelWin.destroy();
    clearTimeout(hookRetryTimer);
    try { hook?.stop(); } catch { /* quitting */ }
    stopCursor();
    clearTimeout(fadeTimer);
    for (const w of overlays.values()) if (!w.isDestroyed()) w.destroy();
    overlays.clear();
    if (panel && !panel.isDestroyed()) panel.destroy();
    panel = null;
    if (tray) tray.destroy();
    tray = null;
    try { stt?.dispose(); } catch { /* quitting */ }
    stt = null;
    try { tts?.dispose(); } catch { /* quitting */ }
  }
  return { start, dispose, togglePanel, status, applyConfig };
}

module.exports = { createOkFilow, hotkeyHeld, okfilowSender, HOTKEYS, DEFAULTS };
