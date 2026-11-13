// OK Filow (docs/BUDDY-PLAN.md): push-to-talk screen helper ported from farzaa/clicky (MIT).
// Main-process side: one click-through overlay per display (the buddy dot, waveform, answer
// bubble, pointing), a small panel window that is also the "brain" (mic, speech-to-text, the
// /api/buddy/ask call, the voice), a tray icon, the hold-to-talk hotkey and the screenshots.
// Screenshots stay in memory; every OK Filow window is excluded from capture.
const { BrowserWindow, Tray, Menu, screen, desktopCapturer, ipcMain, globalShortcut: electronShortcuts, nativeImage, shell, systemPreferences } = require("electron");
const { globalInputOff, shortcutsFor, REFUSED_INSERT } = require("./global-input");
/** Test isolation (global-input.js): no hook, no global shortcut, no typing into other windows, no focus taken. */
const INPUT_OFF = globalInputOff();
const globalShortcut = shortcutsFor(electronShortcuts, INPUT_OFF);
const { keyboardPermission } = require("./mac-permissions");
const path = require("node:path");
const { createGestures, chordHeld, ARM_MS } = require("./okfilow-gestures");
const { createReleaseTail, RELEASE_TAIL_MS } = require("./dictation-release");
const { createHookRetry, describeHookError, QUICK_MS } = require("./okfilow-hook-retry");
const { loadUiohook } = require("./uiohook");
const { createAgents, agentTask, safeToOpen, pickCli } = require("./okfilow-agents");
const { createOutboundState, sanitizeConsent, applyConsentChanges, agentRecipient, agentGranted } = require("./okfilow-outbound");
const { readSelection } = require("./okfilow-selection");
const { createBubble, createMarks, bubbleText, escapePlan, overlayLive, keepsOverlays, pointsShowMs, answering, overlayMouse, seeChoice, wordsOnlyList, pillState, mayCapture, screenSources, pillAction, pauseKeyAction, EYE_KEYS, PAUSE_KEYS, keyChoice, bindKey } = require("./okfilow-stop");
const { createPractice } = require("./tour");
const { modelBounds } = require("./okfilow-model-place");
const { answerRoot, defaultAnswerDir, writeAnswer, deleteAnswers } = require("./okfilow-answers");
const { createElementReader, scanForShot, windowHandle } = require("./okfilow-uia");
const { trustedUiSender } = require("./ui-preferences");
const { createPhoneGate } = require("./okfilow-phone");
// Measured runs (qa-headless.js): nothing of OK Filow appears on screen with FILOW_QA_HEADLESS=1.
const { showWindow, trayFor } = require("./qa-headless");
const { timingsLine } = require("./okfilow-timings");
const { qaMicDelay, createMicOpens, errorEndsHold, createCaptureWatch } = require("./okfilow-mic");

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
  /** "Look at my screen" in the panel: "on" or "off" once the user chose; "auto" until then (the setup for this computer decides). */
  seeScreen: "auto",
  /** Recipients whose yes for questions was given while the notice said "no picture of your screen is sent": that yes does not cover a screenshot. */
  askWordsOnly: [],
  /** The shortcut that opens and closes the eye, and the one for Pause/Resume (okfilow-stop.js EYE_KEYS, PAUSE_KEYS; "none" for no shortcut). */
  eyeKey: EYE_KEYS[0],
  pauseKey: PAUSE_KEYS[0],
};
/** A finite point inside a window's or display's bounds (right and bottom edges excluded). */
const onRect = (x, y, b) => Number.isFinite(x) && Number.isFinite(y) && x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
/** Test builds only: FILOW_OKF_QA=1 lets screen recorders see OK Filow windows, for end-to-end checks. */
// Test switches work only in development or in a QA package (-c.extraMetadata.filowQa=true, see qa.js).
const QA_ALLOWED = require("./qa.js").isQaBuild(require("electron").app);
const QA_VISIBLE = QA_ALLOWED && process.env.FILOW_OKF_QA === "1";
const QA_SHOTS = QA_ALLOWED ? process.env.FILOW_OKF_QA_SHOTS || "" : "";
/**
 * Test builds only: FILOW_OKF_QA_SCREEN=<folder> (001.png ... with NNN.json beside each) stands in for the
 * screen. Every capture takes the next picture and its list of named things, the real screen is never
 * read, and the overlays are never shown (the speed baseline, tools/eval/latency.mjs).
 */
const QA_SCREEN = QA_ALLOWED ? process.env.FILOW_OKF_QA_SCREEN || "" : "";
/** Test builds only: FILOW_OKF_QA_KEYS=1 lets the panel feed the gestures key presses (when Windows refuses the hook). */
const QA_KEYS = QA_ALLOWED && process.env.FILOW_OKF_QA_KEYS === "1";
/**
 * Test builds only: FILOW_OKF_QA_MIC_DELAY=<ms> makes the panel wait that long before it gets the
 * microphone it asked for, like a Windows audio service that takes 15 s to open a device (0.9.37).
 */
const QA_MIC_DELAY = qaMicDelay(QA_ALLOWED ? process.env.FILOW_OKF_QA_MIC_DELAY : "");
/** The answer log's folder when the user has not picked one (okfilow-answers.js defaultAnswerDir). */
const answersFallback = () => defaultAnswerDir(require("electron").app.getPath("userData"), process.env, QA_ALLOWED);
const HOTKEYS = ["ctrl+alt", "ctrl+shift", "alt+shift", "ctrl+meta"];
// 1024 wide keeps buttons readable for the model and answers about twice as fast as 1280 on a local GPU.
const IMAGE_MAX_WIDTH = 1024;
const FADE_AFTER_MS = 1000;
/** Exactly the hotkey's modifiers are down (extra modifiers cancel, so Ctrl+Alt+Del never triggers it). */
const hotkeyHeld = chordHeld;

/**
 * The synthetic screen of a measured run (QA_SCREEN): `NNN.png` pictures, each with `NNN.json`
 * ({ elements: ScreenElement[] }, what Windows would name on it). Each capture takes the next picture,
 * wrapping, through the same resize and JPEG quality as a real screenshot.
 */
function createQaScreen(dir, { nativeImage, fs = require("node:fs"), maxWidth = IMAGE_MAX_WIDTH } = {}) {
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}\.png$/.test(f)).sort();
  if (!files.length) throw new Error(`qa screen: no NNN.png pictures in ${dir}`);
  let next = 0;
  const display = { index: 1, id: "qa-screen", bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const shown = { width: Math.min(1920, maxWidth), height: Math.round((1080 * Math.min(1920, maxWidth)) / 1920) };
  return {
    count: files.length,
    /** `images: false` (the eye closed): no picture, no names; the same screen and display. */
    capture(wantImages) {
      const name = files[next++ % files.length];
      if (!wantImages) return { images: [], screens: [{ index: 1, ...shown, cursor: true }], displays: [display], marked: [], selected: "", elements: [] };
      let img = nativeImage.createFromPath(path.join(dir, name));
      if (img.getSize().width > maxWidth) img = img.resize({ width: maxWidth, quality: "good" });
      const { width, height } = img.getSize();
      let elements = [];
      try {
        const side = JSON.parse(fs.readFileSync(path.join(dir, name.replace(/\.png$/, ".json")), "utf8"));
        if (side && Array.isArray(side.elements)) elements = side.elements;
      } catch { /* a picture without its names: none */ }
      return { images: [`data:image/jpeg;base64,${img.toJPEG(72).toString("base64")}`], screens: [{ index: 1, width, height, cursor: true }], displays: [display], marked: [], selected: "", elements };
    },
  };
}

/** The stored settings after a change: every field is checked, whatever a window sent. What is not in the patch stays as it was. */
function nextCfg(was, patch) {
  const { consentChanges, ...rest } = patch || {};
  const next = { ...was, ...rest };
  // Windows send their consent changes, merged here into what is stored now (okfilow-outbound.js).
  if (consentChanges !== undefined) next.consent = applyConsentChanges(next.consent, consentChanges);
  if (!HOTKEYS.includes(next.hotkey)) next.hotkey = DEFAULTS.hotkey;
  // FreeLLMAPI is only ever the user's own pick in the panel; nothing sets it for them.
  if (next.provider !== "cloud" && next.provider !== "freellm") next.provider = "local";
  if (!["natural", "cloud", "off"].includes(next.voice)) next.voice = "system";
  // Until the user picks a voice, the natural one speaks as soon as its model is on this PC (status()).
  // A patch that says `voiceChosen: false` in so many words hands the voice back to automatic (the
  // Easy page's "Answer out loud"), even when it names a voice; any other change of voice is a pick.
  next.voiceChosen = patch && patch.voiceChosen === false ? false : next.voiceChosen === true || (!!patch && "voice" in patch);
  next.naturalVoice = Math.min(9, Math.max(0, Math.round(Number(next.naturalVoice)) || 0));
  if (!/^#[0-9a-f]{6}$/i.test(String(next.color))) next.color = DEFAULTS.color;
  next.speed = Math.min(1.5, Math.max(0.75, Number(next.speed) || 1));
  next.typedVoice = next.typedVoice === true;
  next.onboarded = next.onboarded === true;
  next.allScreens = next.allScreens === true;
  next.allowScreenshots = next.allowScreenshots === true;
  next.seeScreen = seeChoice(next.seeScreen);
  next.askWordsOnly = wordsOnlyList(next.askWordsOnly);
  next.eyeKey = keyChoice(next.eyeKey, EYE_KEYS);
  next.pauseKey = keyChoice(next.pauseKey, PAUSE_KEYS);
  next.answerLog = next.answerLog === true;
  next.answerDir = typeof next.answerDir === "string" ? next.answerDir.slice(0, 500) : "";
  if (!["auto", "codex", "claude"].includes(next.agentCli)) next.agentCli = "auto";
  next.consent = sanitizeConsent(next.consent);
  return next;
}

function createOkFilow(deps) {
  const { appUrl, getSettings, saveSettings, iconPath, logLine, sttLocal, userData, menuText, isOffline, askKeyboardPermission, dictation } = deps;
  const cfg = () => ({ ...DEFAULTS, ...(getSettings().okFilow || {}) });
  // What Windows names on screen, read beside each screenshot so points land on the real thing (okfilow-uia.js).
  const uia = deps.elementReader === undefined ? createElementReader({ log: logLine }) : deps.elementReader;
  /** A measured run's synthetic screen (QA_SCREEN), or null. */
  const qaScreen = QA_SCREEN ? createQaScreen(QA_SCREEN, { nativeImage }) : null;
  const setCfg = (patch) => {
    const next = nextCfg(cfg(), patch);
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
  /** The question being answered took the screen with it (the eye on the pill next to the pointer). */
  let asksSee = true;
  /** The pill as the panel last described it: the eye now, paused, resumable (okfilow-stop.js pillState). */
  let pill = pillState(null);
  /** The two shortcuts as registered (okfilow-stop.js bindKey): the panel says so when Windows refused one. */
  let eyeBound = { choice: "", accelerator: null, state: "none" };
  let pauseBound = { choice: "", accelerator: null, state: "none" };
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
  const allWindows = () => [panel, modelWin, boardWin, ...overlays.values()].filter((w) => w && !w.isDestroyed());
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
    // Filow's own settings pages belong in the main window (the browser cannot change desktop settings).
    if (u.origin === appUrl && u.pathname.startsWith("/settings/") && deps.openAppPage?.(u.toString())) return;
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

  // ---- the answer bubble (okfilow-stop.js createBubble, docs/okfilow/BUBBLE.md) ----
  // It goes away by itself once nothing runs any more, whatever keeps the overlays up (marks, the
  // always-on pointer): every overlay is told, the mouse is given back, and the overlays may fade.
  /** The overlays whose bubble has the pointer on it right now (webContents ids). */
  const bubbleHover = new Set();
  const bubble = createBubble({
    onPlan: (ms) => { if (QA_SHOTS) logLine(`okfilow qa bubble ${ms === null ? "stays" : `closes in ${ms} ms`} (mode ${mode})`); },
    dismiss: (why) => {
      logLine(`okfilow: bubble closed (${why})`);
      sendOverlays("okfilow:bubble:close", why);
      bubbleHover.clear();
      if (!overlayLive(mode, pill, false)) stopHover.clear();
      for (const w of overlays.values()) applyMouse(w);
      // The answer's marks go with its bubble, however it went.
      answerMarks.drop(`bubble ${why}`);
      if (mode === "idle" || mode === "error") scheduleFade();
    },
  });
  // ---- an answer's marks (okfilow-stop.js createMarks): they last as long as they are told, plus a short hold ----
  const answerMarks = createMarks({
    clear: (why) => {
      logLine(`okfilow: marks cleared (${why})`);
      sendOverlays("okfilow:draw", []);
      if (mode === "idle" || mode === "error") scheduleFade();
    },
  });
  /** An overlay that is no more has the pointer on nothing. */
  function dropHover(senderId) {
    stopHover.delete(senderId);
    if (bubbleHover.delete(senderId)) bubble.setHover(bubbleHover.size > 0);
  }
  /** The bubble's close button (an overlay). */
  ipcMain.on("okfilow:bubble:close", (e) => { if (ourSender(e)) bubble.close("button"); });
  /** The sentence the voice is on (the panel knows): the overlays keep it in view. */
  ipcMain.on("okfilow:spoken", (e, n) => {
    if (!ourSender(e)) return;
    sendOverlays("okfilow:spoken", Number.isInteger(n) ? n : -1);
    // The voice is telling the answer: its marks get the short hold after it, not the longer one of an answer that is only read.
    if (Number.isInteger(n) && n >= 0) answerMarks.set({ spoken: true });
  });

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
    if (p.isVisible()) { p.moveTop(); if (!INPUT_OFF) p.focus(); } else showPanelAtCursor();
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
  let boardWin = null;
  let currentModel = null;
  function showModel(model) {
    currentModel = model;
    if (modelWin && !modelWin.isDestroyed()) {
      modelWin.webContents.send("okfilow:model", model);
      showWindow(modelWin, "model window", true);
      return;
    }
    // In place beside the pointer (no panel: the page draws only the model, its labels and a close button on hover).
    const c = screen.getCursorScreenPoint();
    const at = modelBounds(c, screen.getDisplayNearestPoint(c).workArea);
    modelWin = new BrowserWindow({
      ...at,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: true,
      minWidth: 360,
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
    modelWin.once("ready-to-show", () => modelWin && !modelWin.isDestroyed() && showWindow(modelWin, "model window", true));
    modelWin.loadURL(`${appUrl}/okfilow/model`);
  }
  ipcMain.on("okfilow:model:show", (e, model) => { if (ourSender(e) && model && Array.isArray(model.parts)) showModel(model); });
  // The tour's practice mark (tour.js): it never clears an answer's drawings, only itself.
  // Its mark replaces whatever the overlays drew, so an answer's marks (answerMarks) no longer own them,
  // and their hold timer must not wipe the practice mark. Clearing it touches only what it drew.
  const practiceState = createPractice({
    draw: marks => { answerMarks.forget(); drawMarks(marks); },
    clear: () => { sendOverlays("okfilow:clear", null); if (mode === "idle" || mode === "error") scheduleFade(); },
  });
  /** An overlay finished setting up: it missed what was sent while it loaded, so send it now. */
  ipcMain.on("okfilow:overlay:ready", (e) => {
    if (!ourSender(e)) return;
    e.sender.send("okfilow:state", { mode, purpose: purpose || "talk", sees: asksSee });
    e.sender.send("okfilow:pill", pill);
    e.sender.send("okfilow:outbound", outbound.snapshot());
    const practiceNow = practiceState.mark();
    if (practiceNow) {
      const window = BrowserWindow.fromWebContents(e.sender);
      const mark = window && localMark(practiceNow, window.getBounds());
      if (mark) e.sender.send("okfilow:draw", [mark]);
    }
    // (the first question builds the overlays: the text sent while they loaded is given now)
    if (bubble.text()) e.sender.send("okfilow:text", bubble.text());
    lastCursor = "";
  });
  let panelReady = false;
  ipcMain.on("okfilow:panel:ready", (e) => {
    if (ourSender(e) && e.sender === panel?.webContents) {
      panelReady = true;
      e.sender.send("okfilow:outbound", outbound.snapshot());
      if (quickAskWaiting) { quickAskWaiting = false; e.sender.send("okfilow:quickAsk", null); }
    }
  });
  ipcMain.on("okfilow:model:ready", (e) => {
    if (!ourSender(e) || !currentModel) return;
    e.sender.send("okfilow:model", currentModel);
    logLine(`okfilow: 3D model shown (${currentModel.parts.length} parts)`);
    qaShot("model", 3000);
  });
  ipcMain.on("okfilow:model:close", (e) => { if (ourSender(e) && modelWin && !modelWin.isDestroyed()) modelWin.close(); });
  ipcMain.on("okfilow:askAbout", (e, text) => { if (ourSender(e) && typeof text === "string") sendPanel("okfilow:askText", text.slice(0, 300)); });

  // ---- Whiteboard tutor window (docs/whiteboard/SPEC.md): one of OK Filow's own pages, in an ordinary window ----
  let boardTopic = "";
  /** The whiteboard page has loaded and is listening: until then a topic waits for its "ready". */
  let boardReady = false;
  function showWhiteboard(topic) {
    boardTopic = String(topic || "").slice(0, 400);
    if (boardWin && !boardWin.isDestroyed()) {
      if (boardReady && boardTopic) {
        boardWin.webContents.send("okfilow:whiteboard", boardTopic);
        boardTopic = "";
      }
      if (showWindow(boardWin, "whiteboard")) boardWin.focus();
      return;
    }
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const w = Math.min(1280, wa.width - 40);
    const h = Math.min(860, wa.height - 40);
    boardWin = new BrowserWindow({
      width: w,
      height: h,
      x: Math.round(wa.x + (wa.width - w) / 2),
      y: Math.round(wa.y + (wa.height - h) / 2),
      minWidth: 360,
      minHeight: 480,
      show: false,
      autoHideMenuBar: true,
      title: "Filow Whiteboard",
      backgroundColor: "#121212",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload, backgroundThrottling: false },
    });
    boardWin.setContentProtection(hidden());
    lockDown(boardWin);
    boardReady = false;
    boardWin.on("closed", () => { boardWin = null; boardReady = false; });
    boardWin.once("ready-to-show", () => boardWin && !boardWin.isDestroyed() && showWindow(boardWin, "whiteboard"));
    boardWin.loadURL(`${appUrl}/okfilow/whiteboard`);
  }
  ipcMain.on("okfilow:whiteboard:show", (e, topic) => { if (ourSender(e) && typeof topic === "string") showWhiteboard(topic); });
  /** The whiteboard page finished loading: hand it the topic it was opened for. */
  ipcMain.on("okfilow:whiteboard:ready", (e) => {
    if (!ourSender(e) || !boardWin || boardWin.isDestroyed() || e.sender !== boardWin.webContents) return;
    boardReady = true;
    if (boardTopic) e.sender.send("okfilow:whiteboard", boardTopic);
    boardTopic = "";
    logLine("okfilow: whiteboard shown");
  });
  ipcMain.on("okfilow:whiteboard:close", (e) => { if (ourSender(e) && boardWin && !boardWin.isDestroyed()) boardWin.close(); });
  /** Cards (global DIP) go to the overlay of the display they sit on, in its local coordinates. */
  ipcMain.on("okfilow:cards", (e, list) => {
    if (!ourSender(e) || !Array.isArray(list)) return;
    cardsUp = keepsOverlays(list);
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
    for (const [id, w] of overlays) {
      if (ids.has(id)) continue;
      // A display went away with the pointer on its bubble or pill: that overlay can never say the
      // pointer left, so it is taken off the lists here (else the bubble would wait for ever).
      if (!w.isDestroyed()) { dropHover(w.webContents.id); w.destroy(); }
      overlays.delete(id);
    }
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
        applyMouse(w);
        w.setAlwaysOnTop(true, "screen-saver");
        w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        w.setContentProtection(hidden()); // out of the user's recordings unless they allow it
        lockDown(w);
        w.webContents.on("console-message", (e) => { if (e.level === "warning" || e.level === "error") logLine(`okfilow overlay ${e.level}: ${String(e.message).slice(0, 300)}`); });
        // A new overlay misses whatever was sent while it loaded: give it the state and the cursor now.
        w.webContents.on("did-finish-load", () => {
          if (w.isDestroyed()) return;
          w.webContents.send("okfilow:state", { mode, purpose: purpose || "talk", sees: asksSee });
          w.webContents.send("okfilow:pill", pill);
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
    // The synthetic screen of a measured run (QA_SCREEN): no overlay is ever built or shown.
    if (QA_SCREEN || visible) return;
    visible = true;
    if (QA_SHOTS) logLine("okfilow qa overlays shown");
    buildOverlays();
    for (const [id, w] of overlays) {
      if (w.isDestroyed()) continue;
      showWindow(w, "overlay", true);
      const d = screen.getAllDisplays().find((x) => x.id === id);
      if (d) w.setBounds(d.bounds); // after showing: Windows shrinks hidden windows to the work area
      applyMouse(w);
    }
    startCursor();
  }
  function hideOverlays() {
    if (!visible) return;
    visible = false;
    if (QA_SHOTS) logLine("okfilow qa overlays hidden");
    stopCursor();
    // Hidden overlays have no pill under the pointer: none of them keeps the mouse.
    stopHover.clear();
    bubbleHover.clear();
    bubble.setHover(false);
    for (const w of overlays.values()) if (!w.isDestroyed()) { applyMouse(w); w.hide(); }
  }
  /** An answer's cards (a photo, a drawing) stay up until Escape, the panel's Clear or the next question. */
  let cardsUp = false;
  /** Something of an answer is kept on screen: its cards, or its marks while they last (answerMarks above). */
  const pinned = () => cardsUp || answerMarks.up();
  /** The pointer is still visiting the things an answer points at until then (okfilow-stop.js pointsShowMs). */
  let pointUntil = 0;
  /**
   * The overlays go away a moment after the bubble did (the bubble has its own rule and times,
   * okfilow-stop.js bubbleHold), unless marks are kept or the pointer is always shown.
   */
  function scheduleFade() {
    clearTimeout(fadeTimer);
    // The tour's practice mark (tour.js) keeps them until it is cleared.
    if (practiceState.mark()) return;
    if (cfg().showAlways || pinned() || outbound.active() || bubble.open()) return;
    fadeTimer = setTimeout(() => {
      if (!pinned() && !practiceState.mark() &&!outbound.active() && !bubble.open() && (mode === "idle" || mode === "error")) hideOverlays();
    }, Math.max(FADE_AFTER_MS, pointUntil - Date.now()));
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
    // Only an error about this press: one left over from the recording before must not end the new
    // hold, or its release is dropped and the microphone stays open with the keys up (okfilow-mic.js).
    if (next === "opening" || next === "listening") listenBegun = true;
    if (next === "error" && errorEndsHold({ held, begun: listenBegun })) {
      held = false;
      clearTimeout(dictateCap);
      if (purpose === "dictate") gestures?.endToggle();
      setOverlayMouse(false);
      purpose = null;
    }
    mode = next;
    // Whether the question being answered took the screen: an overlay that loads later is told too.
    if (typeof extra.sees === "boolean") asksSee = extra.sees;
    // The pill's controls take the mouse only while the pill has any (okfilow-stop.js pillLive).
    bubble.setMode(mode, extra);
    answerMarks.set({ mode, stopped: extra.stopped === true });
    if (!overlayLive(mode, pill, bubble.open())) stopHover.clear();
    for (const w of overlays.values()) applyMouse(w);
    // "opening": the panel asked for the microphone; "listening": it is open (okfilow-mic.js, lib/buddy/micOpen.ts).
    // By what the panel says it is for: the keys of a short press are up again before the microphone is open.
    if (next === "opening" && extra.purpose === "dictate") dictation.diag.mark("listening", {}, { once: true });
    if (next === "listening" && extra.purpose === "dictate") dictation.diag.mark("open", {}, { once: true });
    sendOverlays("okfilow:state", { mode, ...extra });
    sendPanel("okfilow:mode", { mode, ...extra });
    if (mode !== "idle" && mode !== "error") {
      clearTimeout(fadeTimer);
      showOverlays();
    } else scheduleFade();
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
    if (showWindow(p, "panel")) p.focus();
  }

  function buildTray() {
    if (tray) return;
    try {
      const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
      const TrayClass = trayFor(Tray);
      tray = new TrayClass(img);
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
    // OK Filow or its eye turned on: the screen names helper is ready by the next question
    if (c.enabled && c.seeScreen !== "off") uia?.start();
    protectAll(hidden());
    if (c.showAlways && c.enabled) showOverlays();
    else if (mode === "idle" && !outbound.active()) hideOverlays();
    if (!c.enabled && (mode === "listening" || mode === "opening")) release();
    if (!c.enabled && handsFree) { handsFree = false; sendPanel("okfilow:handsfree", false); }
    refreshTray();
    bindPillKeys();
    sendPanel("okfilow:config", status());
    sendOverlays("okfilow:config", status());
    return status();
  }

  // ---- the pill's controls and shortcuts (docs/okfilow/PILL.md) ----
  /**
   * A control of the pill, from a click on an overlay or from a shortcut. Stop ends the answer as
   * Escape does; the eye, Pause and Resume go to the panel, which owns the state and acts.
   */
  function control(action, source) {
    if (!action) return false;
    if (action === "stop") return stopAnswer(source === "key" ? "escape" : "button");
    logLine(`okfilow: ${action} (${source})`);
    sendPanel("okfilow:control", { action, source });
    return true;
  }
  /** The eye's shortcut, and Pause/Resume's: registered again only when the choice changed. Off with OK Filow, and under test isolation. */
  function bindPillKeys() {
    const c = cfg();
    const want = (choice) => (c.enabled ? choice : "none");
    const before = `${eyeBound.state} ${pauseBound.state}`;
    if (eyeBound.choice !== want(c.eyeKey)) eyeBound = bindKey(globalShortcut, eyeBound, want(c.eyeKey), () => control("eye", "key"), { inputOff: INPUT_OFF });
    if (pauseBound.choice !== want(c.pauseKey)) pauseBound = bindKey(globalShortcut, pauseBound, want(c.pauseKey), () => control(pauseKeyAction(mode, pill), "key"), { inputOff: INPUT_OFF });
    if (before !== `${eyeBound.state} ${pauseBound.state}`) logLine(`okfilow: shortcuts: eye ${eyeBound.choice} ${eyeBound.state}, pause ${pauseBound.choice} ${pauseBound.state}`);
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
    // The tour's practice mark goes too; its own clear wipes the overlays.
    practiceState.clear();
    if (!pinned() && pointUntil <= Date.now()) return;
    cardsUp = false;
    answerMarks.forget();
    pointUntil = 0;
    sendOverlays("okfilow:clear", null);
    if (mode === "idle" || mode === "error") scheduleFade();
  }

  // ---- keyboard gestures (okfilow-gestures.js) ----
  // Hold the talk chord to ask; hold the dictation chord (dictation.js, default Ctrl+Win) to dictate into
  // the focused app, or tap it twice for hands-free dictation (phrase by phrase, until the keys are pressed
  // once more or Escape); tap the talk chord twice for hands-free questions; tap Ctrl twice for the text box. While talking, the
  // mouse draws a highlighter stroke on the overlay (the overlay takes the mouse only for that time) and
  // the model sees what was marked.
  let gestures = null;
  let purpose = null; // "talk" | "dictate" while the mic is open from a hold
  let handsFree = false;
  let strokes = []; // [{ displayId, points: [[x, y] global DIP] }]
  let selection = Promise.resolve(""); // text selected in the focused app when the talk began
  let dictateCap = null;
  let releasedAt = 0; // when the last dictation's keys went up, for the release-to-text log line
  let pressedAt = 0; // when the last dictation's keys went down, for the "nothing recognised" log line
  let heldMs = 0; // how long they were down
  let phraseRun = null; // dictation-core createPhraseRun() while the phrases of one hands-free dictation are typed
  // Issue #7: a held dictation records a moment more after the keys go up (dictation-release.js).
  const releaseTail = createReleaseTail({ send: (payload) => sendPanel("okfilow:release", payload) });
  /** The panel has begun to listen for the press being held (it said "opening" or "listening" since the keys went down). */
  let listenBegun = false;
  /** Sound with no key held and no hands-free mode is stopped (okfilow-mic.js createCaptureWatch). */
  const captureWatch = createCaptureWatch();

  /** `handsFree`: a dictation with the keys up (double tap, or toggle mode): typed phrase by phrase. */
  function press(kind = "talk", handsFree = false) {
    // The last dictation's release may still wait for its tail: the panel hears it before this press.
    releaseTail.flush();
    // A second brief press right after the first (okfilow-gestures.js): the dictation that just started
    // goes on hands-free. Nothing restarts: the microphone and the recognizer stay as they are.
    if (held && kind === "dictate" && handsFree && purpose === "dictate" && !phraseRun) {
      phraseRun = dictation.newPhraseRun();
      dictation.diag.handsFree();
      sendPanel("okfilow:press", { purpose: "dictate", handsFree: true, upgrade: true });
      return;
    }
    // Dictation has its own switch: it works with OK Filow's questions turned off.
    // Test isolation: no dictation starts, except one a test asked for through the QA key path (the
    // owner's keys never get there: no hook; only a test recording is ever heard; nothing is typed).
    if (held || (kind === "dictate" && INPUT_OFF && !QA_KEYS) || !(kind === "dictate" ? dictation.cfg().enabled : cfg().enabled)) {
      // Not started: the gestures must not count a hands-free dictation as running.
      if (kind === "dictate" && handsFree) gestures?.endToggle();
      return;
    }
    held = true;
    listenBegun = false;
    captureWatch.reset();
    purpose = kind;
    // A hands-free dictation nobody stops ends by itself after five minutes.
    clearTimeout(dictateCap);
    if (kind === "dictate") {
      dictateCap = setTimeout(() => purpose === "dictate" && release(), 5 * 60_000);
      releasedAt = 0; // an earlier dictation that typed nothing must not time this one's phrases
      // A hold is known as one only after the start delay: the keys went down that much earlier.
      const ago = handsFree ? 0 : ARM_MS;
      pressedAt = Date.now() - ago;
      phraseRun = handsFree ? dictation.newPhraseRun() : null;
      dictation.diag.begin(handsFree ? "handsfree" : "hold", ago);
      dictation.warmCleanup();
    }
    // Read the selection while the user's app still has focus; it goes with the question.
    if (kind === "talk") { clearDrawings(); strokes = []; setOverlayMouse(true); selection = INPUT_OFF ? Promise.resolve("") : readSelection(); }
    sendPanel("okfilow:press", { purpose: kind, handsFree: kind === "dictate" && handsFree });
  }
  /** When the talk keys last went up (main's own clock), and when the last Stop came: t0 of the timing lines. */
  let talkReleasedAt = null;
  let stopAt = null;
  function release() {
    if (!held) return;
    held = false;
    const at = Date.now();
    if (purpose === "talk") talkReleasedAt = at;
    clearTimeout(dictateCap);
    // A hold (not hands-free): the words said as the keys go up are still recorded for RELEASE_TAIL_MS.
    const tail = purpose === "dictate" && !phraseRun ? RELEASE_TAIL_MS : 0;
    if (purpose === "dictate") { releasedAt = Date.now(); heldMs = releasedAt - pressedAt; dictation.diag.mark("keys-up"); gestures?.endToggle(); }
    setOverlayMouse(false);
    releaseTail.release({ purpose, at }, tail);
    purpose = null;
  }
  function cancel() {
    if (!held) return;
    held = false;
    clearTimeout(dictateCap);
    if (purpose === "dictate") { gestures?.endToggle(); dictation.diag.mark("keys-up"); dictation.diag.result("cancelled"); }
    setOverlayMouse(false);
    strokes = [];
    sendOverlays("okfilow:strokes", []);
    sendPanel("okfilow:cancel", { purpose });
    purpose = null;
  }
  /** The overlays catch the mouse only while the talk chord is held, so a drag marks instead of clicking. */
  function setOverlayMouse(capture) {
    if (QA_SCREEN) return;
    // Remembered: overlays created or shown later (the first press creates them) must get it too.
    mouseCaught = capture;
    for (const w of overlays.values()) applyMouse(w);
    if (QA_SHOTS) logLine(`okfilow qa mouse ${capture ? "caught" : "through"} on ${overlays.size} overlay(s), visible=${visible}`);
  }
  /** The overlays whose Stop button has the pointer on it right now (webContents ids). */
  const stopHover = new Set();
  /** What each overlay was last told about the mouse (webContents id -> click-through), for the test log. */
  const mouseWas = new Map();
  /** Click-through or not, for one overlay (okfilow-stop.js overlayMouse). */
  function applyMouse(w) {
    if (!w || w.isDestroyed()) return;
    const id = w.webContents.id;
    const m = overlayMouse({ caught: mouseCaught, hover: stopHover.has(id), mode, pill, bubble: bubble.open() });
    w.setIgnoreMouseEvents(m.ignore);
    // Test builds log every change, so an end-to-end run can tell whether Windows would deliver a click.
    if (QA_SHOTS && mouseWas.get(id) !== m.ignore) logLine(`okfilow qa overlay ${id} mouse ${m.ignore ? "click-through" : "takes clicks"} (mode ${mode}, hover ${stopHover.has(id)}, caught ${mouseCaught})`);
    mouseWas.set(id, m.ignore);
  }
  /**
   * Stops the answer in progress (the Stop button, Escape): the panel ends the request, the voice and
   * the pointing. False when no answer was in progress, so Escape keeps its other meanings then.
   */
  function stopAnswer(source) {
    if (!answering(mode)) return false;
    stopAt = Date.now();
    logLine(`okfilow: answer stopped by the user (${source})`);
    sendPanel("okfilow:stop", { source });
    return true;
  }
  /**
   * Escape: stops the answer in progress; when there is none, closes the bubble and wipes the drawings
   * (okfilow-stop.js escapePlan). Always ends a held or hands-free dictation.
   */
  function onEscape() {
    for (const step of escapePlan(mode)) {
      if (step === "stop") stopAnswer("escape");
      else if (step === "bubble") bubble.close("escape");
      else clearDrawings();
    }
    gestures?.escape();
  }
  function onGesture(ev) {
    logLine(`okfilow: gesture ${ev}`);
    switch (ev) {
      case "talk:start": return press("talk");
      case "dictate:start": return press("dictate");
      case "dictate:handsfree": return press("dictate", true);
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
    // While the user holds the keys for the next dictation the words of the last one wait for that
    // release (they go in first, in order): a paste now would be Ctrl + Win + V, and giving up after two
    // seconds left them on the clipboard only. Hold mode only, and for a minute at most: in a hands-free
    // dictation the keys are up, so a key that looks held there is a lost key-up, not a hold.
    const waiting = () => Date.now() < until || (held && purpose === "dictate" && !phraseRun && Date.now() < until + 60_000);
    while (gestures && gestures.anyDown && waiting()) await new Promise((r) => setTimeout(r, 25));
    return !(gestures && gestures.anyDown);
  }
  /**
   * Dictated text from the panel: typed into whatever has focus (dictation.js decides how: directly in
   * Filow's own windows, else clipboard + paste with the user's clipboard put back, or only copied).
   */
  async function typeText(text, spokenLanguage, phrase = false) {
    if (INPUT_OFF) return { ...REFUSED_INSERT };
    // QA key mode: the paste still goes out through uiohook (SendInput), which works without the hook.
    const keys = hook || (QA_KEYS ? loadUiohook().uIOhook : null);
    // `phrase`: one phrase of a hands-free dictation (its last words can arrive after the next press).
    const r = await dictation.insert(text, { hook: keys, keysUp: () => modifiersUp(), spokenLanguage, run: (phrase && phraseRun) || undefined });
    if (releasedAt && r.action !== "none") logLine(`dictation: release to text ${Date.now() - releasedAt} ms (${r.action}${r.reason ? `, ${r.reason}` : ""})`);
    // Issue #7: a press that gave no words used to leave no trace in the log at all.
    else if (releasedAt && !phrase) logLine(`dictation: nothing recognised (keys held ${heldMs} ms${heldMs < 1000 ? ": too short to say anything; hold the keys while speaking, or press them twice briefly for hands-free" : ""})`);
    releasedAt = 0;
    return r;
  }
  /** A question box asked for before the panel finished loading: given once its page says "ready". */
  let quickAskWaiting = false;
  function openQuickAsk(at) {
    showPanelAtCursor(at);
    if (panelReady) sendPanel("okfilow:quickAsk", null);
    else quickAskWaiting = true;
  }
  /**
   * The "OK Filow" button in the main window's sidebar: the panel the type-to-ask key opens, next to the
   * button (`at`, a screen point), its question box focused. Switched off: nothing opens, the caller
   * sends the user to the switch instead.
   */
  function openAsk(at) {
    if (!cfg().enabled) return "off";
    openQuickAsk(at);
    return "open";
  }
  /**
   * A question typed on a paired phone the presenter allowed to ask (okfilow-phone.js has the gate).
   * It goes to the panel on its own channel, never as a question the presenter typed: the panel asks the
   * presenter first, labelled with the device, and answers it words only, silently (apps/web/lib/buddy/phoneAsk.ts).
   * The panel shows without taking the keyboard. "asked", "off", "busy" or "bad".
   */
  const phoneGate = createPhoneGate();
  function askFromPhone(payload) {
    const live = Boolean(panel && !panel.isDestroyed() && !panel.webContents.isLoading());
    const r = phoneGate.decide({ enabled: cfg().enabled, panelReady: panelReady && live, mode }, payload);
    if (r.answer !== "asked") return r.answer;
    if (!panel.isVisible()) showWindow(panel, "panel", true);
    sendPanel("okfilow:phoneAsk", { text: r.question, device: r.device });
    logLine(`okfilow: a question from a paired phone (${Array.from(r.question).length} characters), waiting for the presenter's yes`);
    return "asked";
  }
  ipcMain.on("okfilow:phoneAskDone", (e) => { if (ourSender(e) && e.sender === panel?.webContents) phoneGate.done(); });
  /** Shows the panel next to the mouse (or next to `at`) and gives it the keyboard. */
  function showPanelAtCursor(at) {
    const p = buildPanel();
    const c = at || screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(c).workArea;
    const [w, h] = p.getSize();
    p.setPosition(Math.round(Math.min(Math.max(wa.x + 8, c.x + 14), wa.x + wa.width - w - 8)), Math.round(Math.min(Math.max(wa.y + 8, c.y + 18), wa.y + wa.height - h - 8)));
    // Windows only lets the process that sent the last input take the foreground: a tap of F24
    // (a key no app uses) from our hook makes that us, so the box really gets the keyboard.
    // Test isolation: the panel shows without taking the keyboard from the window the person is using.
    if (INPUT_OFF) { if (showWindow(p, "panel", true)) p.moveTop(); return; }
    try { if (hook) hook.keyTap(loadUiohook().UiohookKey.F24); } catch { /* focus may stay put */ }
    if (!showWindow(p, "panel")) return;
    p.moveTop();
    p.focus();
    p.webContents.focus();
  }

  /** Registers the keyboard hook; throws when the system refuses it (hookRetry below tries again). */
  function registerHook() {
    {
      // macOS: no hook before the permission is there (mac-permissions.js); the toggle below works meanwhile.
      const missing = keyboardPermission({ platform: process.platform, systemPreferences });
      if (missing) throw Object.assign(new Error(`macOS has not allowed reading the keyboard yet (${missing})`), { permission: missing });
      const { uIOhook, UiohookKey: K } = loadUiohook();
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
        dictate: () => dictation.activeChord(cfg().hotkey, { qaKeys: QA_KEYS }),
        dictateMode: () => dictation.cfg().mode,
        emit: onGesture,
      });
      uIOhook.on("keydown", (e) => {
        // Windows injects a keycode-0 "mask" key while Win is held (so Start does not open): not a key press.
        if (!e.keycode) return;
        const k = map[e.keycode] || null;
        gestures.keydown(k);
        if (!k) dictation.userMoved(); // the caret may have moved: no joining space before the next dictation
        if (e.keycode === K.Escape) onEscape();
        // Hands-free dictation: after the user's own Enter or Tab the next phrase starts without a space.
        if (phraseRun && (e.keycode === K.Enter || e.keycode === K.NumpadEnter || e.keycode === K.Tab)) phraseRun.moved();
      });
      uIOhook.on("keyup", (e) => { if (e.keycode) gestures.keyup(map[e.keycode] || null); });
      // Key-ups on the secure desktop (Win+L, Ctrl+Alt+Del, sleep) never reach the hook: start clean
      // after them. (The modifier flags on hook events are not reliable on Windows: Alt reads false.)
      // Once only: a failed start is retried (okfilow-hook-retry.js) and must not add listeners each time.
      if (!powerWired) {
        powerWired = true;
        const { powerMonitor } = require("electron");
        for (const ev of ["lock-screen", "unlock-screen", "suspend", "resume"]) powerMonitor.on(ev, () => gestures.reset());
        // After an unlock or a wake-up Windows often allows the hook again: do not wait out the retry delay.
        for (const ev of ["unlock-screen", "resume"]) powerMonitor.on(ev, () => hookRetry.nudge());
      }
      uIOhook.on("mousedown", () => {
        // A click anywhere but on the bubble or the pill, once the answer has ended: the screen may
        // have changed under the marks, so they go (while the answer is told they stay).
        if (!bubbleHover.size && !stopHover.size) answerMarks.screenChanged();
        gestures.mousedown();
        dictation.userMoved();
        if (phraseRun) phraseRun.moved(); // a click may have moved the caret
      });
      uIOhook.start();
      hook = uIOhook;
    }
  }
  let powerWired = false;
  let hookFailures = 0; // failed tries since the hook last worked, and when the last try was ("Report a problem")
  let hookLastTryAt = 0;
  // Issue #6: the hook is tried again for as long as Filow runs (four quick tries, then a growing delay, and
  // at once after unlock, wake-up or a display change); the fallback key works meanwhile and the panel and
  // Settings say so. When a try succeeds the hold keys are back without a restart.
  const hookRetry = createHookRetry({
    start: registerHook,
    // Windows can refuse the hook for a moment (another app just let go of one): quick tries first.
    quickFor: (e) => /register|hook/i.test(String((e && e.message) || e)) && !(e && e.permission),
    onUp: ({ failures }) => {
      hookFailures = failures || 0;
      hookLastTryAt = Date.now();
      hookError = "";
      hookPermission = "";
      try { globalShortcut.unregister("CommandOrControl+Alt+O"); } catch { /* was not registered */ }
      logLine(`okfilow: hold-to-talk hook started${failures ? ` (after ${failures} failed ${failures === 1 ? "try" : "tries"}; the hold keys work again)` : ""}`);
      sendPanel("okfilow:config", status());
    },
    onDown: ({ error: e, failures, delayMs, quick, fallback }) => {
      // A start that failed leaves its key listeners on the hook: drop them before any retry adds new ones.
      try { loadUiohook().uIOhook.removeAllListeners(); } catch { /* nothing attached */ }
      const changed = !hookError;
      hookFailures = failures || 0;
      hookLastTryAt = Date.now();
      hookError = String((e && e.message) || e);
      hookPermission = (e && e.permission) || keyboardPermission({ platform: process.platform, systemPreferences, error: e }) || "";
      if (hookPermission && askKeyboardPermission) void askKeyboardPermission(hookPermission);
      const why = describeHookError(e);
      if (quick) logLine(`okfilow: keyboard hook not ready (${why}), retry ${failures} of ${QUICK_MS.length}`);
      else if (fallback) logLine(`okfilow: keyboard hook unavailable (${why}); Ctrl+Alt+O works meanwhile; still trying in the background (next try in ${Math.round(delayMs / 1000)} s, then at most every 60 s, and after unlock, wake-up or a display change)`);
      else if (failures % 10 === 0) logLine(`okfilow: keyboard hook still unavailable after ${failures} tries (${why}); next try in ${Math.round(delayMs / 1000)} s`);
      if (fallback) {
        try {
          if (!globalShortcut.isRegistered("CommandOrControl+Alt+O")) {
            globalShortcut.register("CommandOrControl+Alt+O", () => {
              if (held) return release();
              held = true;
              sendPanel("okfilow:press");
            });
          }
        } catch { /* the main hotkey code owns errors */ }
      }
      // The panel and Settings say that the hold keys are unavailable and which key works meanwhile.
      if (changed || fallback) sendPanel("okfilow:config", status());
    },
  });
  function startHook() {
    if (!INPUT_OFF) return hookRetry.attempt();
    // Test isolation: the gestures exist (the QA key path feeds them), on a stand-in hook that hears and sends nothing.
    try { registerHook(); } catch (e) { logLine(`okfilow: gestures not set up (${e && e.message})`); }
    logLine("okfilow: global input is off: no keyboard hook, no fallback shortcut; keys reach the gestures only through the QA key path");
  }

  // ---- screenshots ----
  /** `images: false` ("Look at my screen" is off): no picture of the screen is taken at all; the rest (which screen has the mouse, the selected text) is still returned. */
  async function capture(opts = {}) {
    // The eye closed (the stored setting is "off"): no picture is taken, whoever asks and whatever they ask for.
    const want = { images: opts.images, seeScreen: cfg().seeScreen };
    const wantImages = mayCapture(want);
    // A measured run's synthetic screen: the real one is never read, and nothing is waited for.
    if (qaScreen) {
      selection = Promise.resolve("");
      strokes = [];
      return qaScreen.capture(wantImages);
    }
    const displays = screen.getAllDisplays();
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)));
    const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)));
    // Cursor display first: the model weighs the first image most.
    // Only the screen with the mouse, like HeyClicky: one image instead of one per monitor halves the
    // time a local model needs. Other screens are added only when the setting asks for them.
    const ordered = (cfg().allScreens ? [cursor, ...displays.filter((d) => d.id !== cursor.id)] : [cursor]).slice(0, 4);
    // The names on those screens, read while the picture is taken; no picture, no scan (okfilow-uia.js).
    // (OK Filow's own windows, kept out of the picture below, are left out of the names too; the main window is in both)
    const named = scanForShot(uia, ordered, { pictures: wantImages, toRect: screen.dipToScreenRect && ((b) => screen.dipToScreenRect(null, b)), skip: allWindows().map(windowHandle).filter(Boolean) });
    const sources = await screenSources(want, async () => {
      if (!hidden()) protectAll(true); // the model never sees OK Filow itself
      try {
        return await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.min(maxW, 2560), height: Math.min(maxH, 2560) } });
      } finally {
        if (!hidden()) protectAll(false);
      }
    });
    const selected = await Promise.race([selection, new Promise((r) => setTimeout(() => r(""), 1200))]);
    selection = Promise.resolve("");
    const out = { images: [], screens: [], displays: [], marked: [], selected, elements: [] };
    /** Each display's place among the screenshots (0: none was taken of it). */
    const pictured = ordered.map(() => 0);
    ordered.forEach((d, at) => {
      if (!wantImages) {
        const index = out.screens.length + 1;
        out.screens.push({ index, width: d.bounds.width, height: d.bounds.height, cursor: d.id === cursor.id });
        out.displays.push({ index, id: d.id, bounds: d.bounds });
        return;
      }
      const src = sources.find((s) => String(s.display_id) === String(d.id)) || (displays.length === 1 ? sources[0] : null);
      if (!src || src.thumbnail.isEmpty()) return;
      let img = src.thumbnail;
      const size = img.getSize();
      if (size.width > IMAGE_MAX_WIDTH) img = img.resize({ width: IMAGE_MAX_WIDTH, quality: "good" });
      const { width, height } = img.getSize();
      const index = out.images.length + 1;
      pictured[at] = index;
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
    if (wantImages && !out.images.length) throw new Error(menuText("okfNoCapture"));
    out.elements = await named(pictured);
    return out;
  }

  function status() {
    const c = cfg();
    if (!c.voiceChosen && c.voice === "system" && tts?.usable()) c.voice = "natural";
    // Dictation keeps its own settings (dictation.js); the panel shows its switch and keys from here.
    const d = dictation.status({ talkHotkey: c.hotkey, hook: Boolean(hook) });
    // answerDir: the folder the log writes to, also when the user has not picked one (the panel shows its name).
    return { ...c, answerDir: answerRoot(c.answerDir, answersFallback()), hotkeys: HOTKEYS, offline: isOffline(), hook: hook ? "hold" : "toggle", hookError, hookPermission, hookFailures, hookLastTryAt, mode, handsFree, eyeKeys: EYE_KEYS, pauseKeys: PAUSE_KEYS, eyeKeyState: eyeBound.state, pauseKeyState: pauseBound.state, dictation: d.enabled, dictateChord: d.chord, dictationStatus: d, ...(QA_MIC_DELAY ? { qaMicDelayMs: QA_MIC_DELAY } : {}) };
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
  ipcMain.handle("okfilow:capture", guard(async (opts) => {
    const t = Date.now();
    const out = await capture(opts && typeof opts === "object" ? { images: opts.images !== false } : {});
    logLine(`okfilow: captured ${out.images.length} screen(s) in ${Date.now() - t} ms, ${out.elements.length} named thing(s)`);
    return out;
  }));
  ipcMain.handle("okfilow:setMode", guard((m, extra) => (logLine(`okfilow: mode ${m}${extra && extra.error ? ` (${String(extra.error).slice(0, 200)})` : ""}`), extra && extra.error && deps.onAnswerError && deps.onAnswerError({ error: String(extra.error), code: typeof extra.code === "string" ? extra.code : "" }), setMode(typeof m === "string" ? m : "idle", extra && typeof extra === "object" ? extra : {}))));
  ipcMain.on("okfilow:level", (e, level) => ourSender(e) && sendOverlays("okfilow:level", Number(level) || 0));
  let lastQaText = "";
  ipcMain.on("okfilow:text", (e, text) => {
    if (!ourSender(e)) return;
    const t = bubbleText(text);
    sendOverlays("okfilow:text", t);
    const was = bubble.open();
    bubble.setText(t);
    if (was !== bubble.open()) {
      // The bubble came or went under a pointer that may stand still: the mouse rule follows it.
      if (!overlayLive(mode, pill, bubble.open())) stopHover.clear();
      for (const w of overlays.values()) applyMouse(w);
    }
    if (!bubble.open() && (mode === "idle" || mode === "error")) scheduleFade();
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
  ipcMain.handle("okfilow:typeText", guard((text, lang, phrase) => typeText(typeof text === "string" ? text.slice(0, 20000) : "", typeof lang === "string" ? lang.slice(0, 5) : "", phrase === true)));
  /** Test builds only (FILOW_OKF_QA_KEYS=1): key presses for the gestures, as the hook would deliver them. */
  ipcMain.on("okfilow:qa:key", (e, type, key) => {
    if (!QA_KEYS || !ourSender(e) || !gestures) return;
    const mod = ["ctrl", "alt", "shift", "meta"].includes(key) ? key : null;
    // "eye" and "pause": what the two global shortcuts do, so a run under test isolation can press them.
    if (type === "down" && key === "eye") return void control("eye", "key");
    if (type === "down" && key === "pause") return void control(pauseKeyAction(mode, pill), "key");
    if (key === "eye" || key === "pause") return;
    if (type === "down") { gestures.keydown(mod); if (key === "escape") onEscape(); }
    else if (type === "up") gestures.keyup(mod);
  });
  /** A click on a control of the pill (an overlay), or the same from the panel's row. */
  ipcMain.on("okfilow:control", (e, action) => { if (ourSender(e)) control(pillAction(action), "button"); });
  /** The panel says what the pill shows now; every overlay is told, and the mouse rule follows. */
  ipcMain.on("okfilow:pill", (e, v) => {
    if (!ourSender(e) || !panel || panel.isDestroyed() || e.sender !== panel.webContents) return;
    pill = pillState(v);
    sendOverlays("okfilow:pill", pill);
    bubble.setPaused(pill.paused);
    answerMarks.set({ paused: pill.paused });
    if (!overlayLive(mode, pill, bubble.open())) stopHover.clear();
    for (const w of overlays.values()) applyMouse(w);
  });
  /** The Stop button (the pill next to the pointer, or the panel when the keyboard hook is down). */
  ipcMain.on("okfilow:stopAnswer", (e, source) => { if (ourSender(e)) stopAnswer(source === "panel" ? "panel" : "button"); });
  /** An overlay says the pointer is on (or off) a control of its pill: that overlay takes the mouse meanwhile. */
  /** `onBubble`: the pointer is on the answer bubble (it then stays, and its text scrolls under the wheel). */
  ipcMain.on("okfilow:overlay:hover", (e, on, onBubble) => {
    if (!ourSender(e)) return;
    if (on === true && overlayLive(mode, pill, bubble.open())) stopHover.add(e.sender.id);
    else stopHover.delete(e.sender.id);
    if (on === true && onBubble === true && bubble.open()) bubbleHover.add(e.sender.id);
    else bubbleHover.delete(e.sender.id);
    bubble.setHover(bubbleHover.size > 0);
    if (QA_SHOTS) logLine(`okfilow qa stop hover ${on === true} from overlay ${e.sender.id} (mode ${mode}): takes the mouse = ${stopHover.has(e.sender.id)}`);
    for (const w of overlays.values()) applyMouse(w);
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
    if (!ourSender(e) || !Array.isArray(points) || QA_SCREEN) return;
    // An empty list only calls the pointer back (a new question, a stop): it keeps nothing on screen.
    if (!keepsOverlays(points)) return sendOverlays("okfilow:point", []);
    // The pointer's visits end by themselves: they keep the overlays for as long as they take, not until Escape.
    pointUntil = Date.now() + pointsShowMs(points.length);
    if (mode === "idle" || mode === "error") scheduleFade();
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
  /** `from` (Resume after Stop): the first `from` marks were drawn before the stop; they are shown as they were, the rest are drawn now. */
  /** Kept while the answer and its bubble last (answerMarks); an empty list keeps nothing. They replace the practice mark. */
  ipcMain.on("okfilow:draw", (e, marks, from) => {
    if (!ourSender(e) || !Array.isArray(marks) || QA_SCREEN) return;
    answerMarks.drawn(marks);
    practiceState.forget();
    drawMarks(marks, from);
  });
  /** Sends `marks` (global DIP) to each overlay; the caller decides how long they are kept. */
  function drawMarks(marks, from) {
    showOverlays();
    qaShot("draw");
    const drawn = Math.max(0, Math.round(Number(from)) || 0);
    for (const w of overlays.values()) {
      if (w.isDestroyed()) continue;
      const b = w.getBounds();
      const mine = marks.map((m, i) => { const l = m && typeof m === "object" ? localMark(m, b) : null; return l && i < drawn ? { ...l, done: true } : l; }).filter(Boolean);
      w.webContents.send("okfilow:draw", mine);
    }
  }

  // Speech-to-text on this PC: its own sherpa session, so it never steals the presenter's.
  ipcMain.handle("okfilow:stt:status", guard(() => ({ ready: sttLocal.modelReady(userData) })));
  ipcMain.handle("okfilow:stt:start", async (event, language) => {
    if (!ourSender(event)) throw new Error("Denied");
    // First use on a clean PC: start the download instead of only refusing.
    if (!sttLocal.modelReady(userData)) { deps.sttDownload?.(); throw new Error(menuText("okfNoStt")); }
    // the model the user chose (Settings > Advanced) for dictation or for OK Filow's questions, whichever is listening
    if (!stt) stt = new sttLocal.SttSession(userData, logLine, { task: () => (purpose === "dictate" ? "dictation" : "questions") });
    const wc = event.sender;
    stt.onResult = (r) => !wc.isDestroyed() && wc.send("okfilow:stt:result", { partial: r.partial, committed: r.committed });
    stt.onError = (m) => !wc.isDestroyed() && wc.send("okfilow:stt:result", { partial: "", committed: "", error: m });
    return stt.start(typeof language === "string" ? language : "auto");
  });
  ipcMain.on("okfilow:stt:feed", (e, samples) => {
    if (!ourSender(e)) return;
    // The watchdog: the microphone never keeps running with the keys up and no hands-free mode on.
    // (A release still waiting for its tail counts as held.) The panel is told to stop, and nothing of it is used.
    if (captureWatch.frame(held || handsFree || releaseTail.waiting)) {
      logLine("okfilow: the microphone was still open with no key held: stopped");
      sendPanel("okfilow:cancel", { purpose: null, watchdog: true });
    }
    if (!stt) return;
    if (held && purpose === "dictate") dictation.diag.mark("audio", {}, { once: true }); // the microphone delivers sound
    stt.feed(samples instanceof Float32Array ? samples : new Float32Array(samples));
  });
  ipcMain.handle("okfilow:stt:stop", guard(() => stt?.stop()));

  // The natural voice on this PC (tts.js, docs/okfilow/VOICE.md). A model that arrives or leaves
  // changes which voice speaks by default, so the windows get the new config.
  tts = require("./tts").wireTts({
    ipcMain, ours: ourSender, userData, logLine, isOffline,
    qaDir: QA_ALLOWED ? process.env.FILOW_OKF_QA_TTS_DIR || "" : "",
    onChange: () => { sendPanel("okfilow:config", status()); sendOverlays("okfilow:config", status()); },
    // main.js's registry of downloads in flight: Stop works from Filow Settings too (model-files.js)
    ...(deps.downloads ? { downloads: deps.downloads } : {}),
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

  /**
   * The speed baseline's marks for one answer (okfilow-timings.js): numbers and fixed names only reach
   * the log. Only from the panel.
   */
  ipcMain.on("okfilow:timings", (e, payload) => {
    if (!ourSender(e) || !panel || panel.isDestroyed() || e.sender !== panel.webContents) return;
    const line = timingsLine(payload, { releaseAt: talkReleasedAt, stopAt });
    if (line) logLine(line);
  });
  /**
   * How long the microphone took to open, from the panel (okfilow-mic.js): one line for every slow
   * open, numbers and fixed words only, and the count for "Report a problem".
   */
  const micOpens = createMicOpens();
  ipcMain.on("okfilow:mic", (e, payload) => {
    if (!ourSender(e)) return;
    const line = micOpens.note(payload);
    if (line) logLine(line);
  });

  // ---- lifecycle ----
  function start() {
    if (qaScreen) logLine(`okfilow: qa screen: ${qaScreen.count} picture(s), overlays off`);
    buildTray();
    buildPanel();
    startHook();
    bindPillKeys();
    // The screen names helper is ready before the first question (about 0.1 s to start; Windows only).
    if (cfg().enabled && cfg().seeScreen !== "off") uia?.start();
    // Dictation turned off, or its keys changed, while it records: stop without typing.
    dictation.onChange((d) => {
      if (purpose === "dictate" && (!d.enabled || !dictation.activeChord(cfg().hotkey, { qaKeys: QA_KEYS }))) cancel();
      sendPanel("okfilow:config", status());
    });
    screen.on("display-added", () => visible && buildOverlays());
    screen.on("display-removed", () => buildOverlays());
    screen.on("display-metrics-changed", () => buildOverlays());
    // A display change (docking, a remote session taking over) is another moment the hook may register again.
    for (const ev of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(ev, () => hookRetry.nudge());
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
    try { uia?.stop(); } catch { /* quitting */ }
    outbound.clear();
    if (modelWin && !modelWin.isDestroyed()) modelWin.destroy();
    if (boardWin && !boardWin.isDestroyed()) boardWin.destroy();
    hookRetry.stop();
    for (const k of [eyeBound, pauseBound]) { if (k.accelerator) { try { globalShortcut.unregister(k.accelerator); } catch { /* quitting */ } } }
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
  /** Delete of a speech model (main.js): the recognizer for questions and dictation lets go of its files first. */
  const releaseStt = (key) => {
    if (!stt || (key !== undefined && stt.modelKey !== key)) return Promise.resolve();
    const gone = stt.dispose();
    stt = null;
    return Promise.resolve(gone);
  };
  /** The natural voice for main.js's models list: { installed, usable, loaded, stopDownload, remove }. */
  const voiceModel = () => tts;
  /** The speech model OK Filow's recognizer holds in memory right now, or null. */
  const sttLoaded = () => (stt && stt.worker ? stt.modelKey : null);
  const practice = mark => practiceState.show(mark);
  const clearPractice = () => practiceState.clear();
  const askPractice = question => {
    if (!panelReady || !panel || panel.isDestroyed() || panel.webContents.isLoading()) return false;
    clearPractice(); showWindow(panel, "panel");
    sendPanel("okfilow:askText", question);
    return true;
  };
  /** The live "going outside" signal, for requests made outside OK Filow (the account's, main.js). */
  const outboundSignal = () => ({ begin: outbound.begin, end: outbound.end });
  return { start, dispose, togglePanel, showWhiteboard, status, applyConfig, releaseStt, voiceModel, sttLoaded, practice, clearPractice, askPractice, openAsk, askFromPhone, micReport: () => micOpens.report(), outboundSignal };
}

/**
 * A point a page sent (its CSS pixels, from the top left of its window's content) on the screen, for
 * placing the panel next to the button that opened it. Anything that is not two finite numbers inside
 * the window is ignored (null): the panel then opens next to the mouse, as the key does.
 */
function pagePointOnScreen(content, zoom, at) {
  if (!content || !at || typeof at !== "object") return null;
  const { x, y } = at;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const z = typeof zoom === "number" && zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
  const px = x * z, py = y * z;
  if (px < 0 || py < 0 || px > content.width || py > content.height) return null;
  return { x: Math.round(content.x + px), y: Math.round(content.y + py) };
}

module.exports = { createOkFilow, createQaScreen, hotkeyHeld, okfilowSender, HOTKEYS, DEFAULTS, nextCfg, pagePointOnScreen };
