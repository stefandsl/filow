// Desktop shell: runs the Next.js standalone server and the session relay inside
// Electron and opens the app in a window. Keys live in <userData>/.env, talking
// points in <userData>/script.md. Topology: ARCHITECTURE.md §5.3.
//   LAN mode (default): both servers bind 0.0.0.0 so a phone on the Wi-Fi can open
//     the mirror; the spend endpoints are gated by a per-launch random password.
//   Hosted mode: FILOW_SESSION_URL (+ ACCESS_PASSWORD) in .env points the
//     engine at a public session server; local servers stay on 127.0.0.1.
const { app, BrowserWindow, Menu, shell, session, dialog, desktopCapturer, globalShortcut, ipcMain, screen, nativeTheme, systemPreferences, Notification, clipboard } = require("electron");

// Links leave the app only as web or mail addresses: never file:, custom protocols or scripts.
function openExternalSafe(url) {
  let u;
  try { u = new URL(String(url)); } catch { return Promise.resolve(); }
  if (!["https:", "http:", "mailto:"].includes(u.protocol)) { console.warn(`blocked external link ${u.protocol}`); return Promise.resolve(); }
  return shell.openExternal(u.toString());
}
// The system's own privacy settings pages (microphone permission): only these two schemes, never a link.
function openSystemSettings(url) {
  let u;
  try { u = new URL(String(url)); } catch { return Promise.resolve(); }
  if (!["ms-settings:", "x-apple.systempreferences:"].includes(u.protocol)) { console.warn(`blocked settings link ${u.protocol}`); return Promise.resolve(); }
  return shell.openExternal(u.toString());
}
// SEC-04: a window stays on Filow's own pages. Any other navigation is refused and a page cannot open
// a window; web and mail links go to the system browser instead (openExternalSafe drops the rest).
// The pages loaded from files (splash, region picker) have nowhere to go at all.
function isAppPage(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "http:" && u.origin === APP_URL; // not blob: or data: made by a page
  } catch {
    return false;
  }
}
function guardNavigation(win) {
  win.webContents.on("will-navigate", (event, url) => {
    if (isAppPage(url)) return;
    event.preventDefault();
    void openExternalSafe(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafe(url);
    return { action: "deny" };
  });
}
// Test builds only: FILOW_OKF_FAKE_MIC=<wav> feeds that file to every microphone, so OK Filow's voice
// paths can be checked end to end without a person talking.
// QA builds only (apps/desktop/qa.js): never unlocked by a file next to the exe.
if (process.env.FILOW_OKF_FAKE_MIC && require("./qa.js").isQaBuild(app)) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-file-for-fake-audio-capture", process.env.FILOW_OKF_FAKE_MIC);
}
// QA builds only: FILOW_QA_SOCKET_LOG=<file> writes one line per TCP connection this process opens
// (the in-process Next server and session relay included) for the take probe's offline audit (PR-01):
// netstat samples miss connections shorter than its interval. FILOW_QA_PROBE_SERVER_OUTBOUND=<host:port>
// opens one short connection from this process once the servers run, to show the log catches it.
if (process.env.FILOW_QA_SOCKET_LOG && require("./qa.js").isQaBuild(app)) {
  const socketLog = process.env.FILOW_QA_SOCKET_LOG;
  require("./qa.js").installSocketLog((line) => require("node:fs").appendFileSync(socketLog, line));
}
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.FILOW_PORT || 4747);
const SESSION_PORT = Number(process.env.FILOW_SESSION_PORT || 4748);
const APP_URL = `http://127.0.0.1:${PORT}`;

const packaged = app.isPackaged;
// Packaged: resources/app/apps/web/server.js and resources/server/bundle.js.
// Dev: ../web/.next/standalone/apps/web/server.js and ../server/dist/bundle.js.
const resources = packaged ? process.resourcesPath : path.join(__dirname, "..");
const webServer = packaged
  ? path.join(resources, "app", "apps", "web", "server.js")
  : path.join(resources, "web", ".next", "standalone", "apps", "web", "server.js");
const sessionServer = packaged ? path.join(resources, "server", "bundle.js") : path.join(resources, "server", "dist", "bundle.js");
const seedDir = packaged ? resources : path.join(resources, "web");
// Isolated QA profile; must be set before any profile or Chromium cache access.
if (process.env.FILOW_USER_DATA_DIR) {
  if (!path.isAbsolute(process.env.FILOW_USER_DATA_DIR)) throw new Error("FILOW_USER_DATA_DIR must be absolute");
  fs.mkdirSync(process.env.FILOW_USER_DATA_DIR, { recursive: true });
  app.setPath("userData", process.env.FILOW_USER_DATA_DIR);
  app.setPath("sessionData", process.env.FILOW_USER_DATA_DIR);
}
const userData = app.getPath("userData");
// One Filow per profile (single-instance.js): a second launch starts nothing and brings the running
// window forward instead of fighting for the ports. Keyed on userData, so test profiles still coexist.
const { claimSingleInstance, windowToFront, bringToFront } = require("./single-instance");
const firstInstance = claimSingleInstance(app, () => {
  logLine("second launch on this profile: bringing the running window forward");
  bringToFront(windowToFront({ welcome: welcomeWin, main: mainWin, splash }));
});
if (!firstInstance) {
  logLine("second launch on this profile: Filow already runs, leaving");
  app.exit(0);
}
// Native crash dumps (main, renderer, GPU, utility) stay on this PC under userData/Crashpad; nothing
// is uploaded. "Report a problem" lists them but never includes them; nothing is sent by Filow.
app.setPath("crashDumps", path.join(userData, "Crashpad"));
require("electron").crashReporter.start({ uploadToServer: false });
const envFile = path.join(userData, ".env");
const scriptFile = path.join(userData, "script.md");
const settingsFile = path.join(userData, "settings.json");
// ---- Rebrand compatibility (Intelliprompter -> Filow, 0.8.0) ----
// Installed copies keep working: the profile folder moves once, legacy FILOW_* / INTELLIPROMPTER_*
// environment names are both accepted, the NSIS appId is unchanged so upgrades replace the old
// install, and the PowerPoint registration is rewritten to the new manifest path.
const LEGACY_PROFILE_DIRS = [path.join(app.getPath("appData"), "@intelliprompter", "desktop"), path.join(app.getPath("appData"), "Intelliprompter")];
const LEGACY_ENV_PREFIX = "INTELLIPROMPTER_";

function aliasLegacyEnv() {
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith(LEGACY_ENV_PREFIX) && v !== undefined) {
      const nk = "FILOW_" + k.slice(LEGACY_ENV_PREFIX.length);
      if (!(nk in process.env)) process.env[nk] = v;
    }
  }
}

/** Copies settings, keys, script, certificates, add-in files and the tunnel tool from the old profile, once. */
function migrateLegacyProfile() {
  if (process.env.FILOW_USER_DATA_DIR) return false;
  if (fs.existsSync(settingsFile) || fs.existsSync(envFile)) return false;
  const src = LEGACY_PROFILE_DIRS.find((d) => fs.existsSync(path.join(d, "settings.json")) || fs.existsSync(path.join(d, ".env")));
  if (!src) return false;
  fs.mkdirSync(userData, { recursive: true });
  for (const entry of ["settings.json", ".env", "script.md", "install-choices.json", "certs", "powerpoint", "bin"]) {
    const from = path.join(src, entry);
    if (!fs.existsSync(from)) continue;
    try {
      fs.cpSync(from, path.join(userData, entry), { recursive: true });
    } catch (err) {
      logLine(`migration: could not copy ${entry}: ${err.message}`);
    }
  }
  logLine(`migrated profile from ${src}`);
  return true;
}

/** After a profile move the Office registration points at the old manifest path; rewrite it. */
async function refreshPptRegistrationAfterMigration() {
  if (!settings.pptInstalled) return;
  try {
    writeLocalPptManifest();
    await registerPptManifest();
    if (process.platform === "win32") {
      await runPowerShell(`Remove-ItemProperty -Path 'Registry::HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer' -Name 'Intelliprompter' -ErrorAction SilentlyContinue`);
    } else if (process.platform === "darwin") {
      fs.rmSync(path.join(macWefDir, "intelliprompter.manifest.xml"), { force: true });
    }
    logLine("PowerPoint registration refreshed after migration");
  } catch (err) {
    logLine(`PowerPoint registration refresh failed: ${err.message}`);
  }
}


// ---- Screen Sense (ARCHITECTURE.md §6.1): sources, region picker, global hotkey ----
const DEFAULT_HOTKEY = "CommandOrControl+Shift+Space";
let settings = { screenHotkey: DEFAULT_HOTKEY, screenSense: true, contentProtection: false, remoteShare: true, mirrorHost: "", lang: "", theme: "system", overlayAuto: true, overlayHidden: false, overlayOpacity: 0.94 };

// Shell strings live in the shared dictionary (packages/core/src/i18n, bundled to vendor/i18n.js), so
// the parity check covers them in every language. The page owns the language choice and tells us over
// IPC; "" = system locale.
const { t: sharedText, isLang, langFromLocale } = require("./vendor/i18n");
function menuLang() {
  return isLang(settings.lang) ? settings.lang : langFromLocale(app.getLocale());
}
/** A menu or dialog text of the shell: `menu.<key>` in the shared dictionary. */
function mt(key, vars) {
  return sharedText(`menu.${key}`, menuLang(), vars);
}
let initialUiSettings = {};
function loadSettings() {
  try {
    const loaded = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      initialUiSettings = { ...loaded };
      settings = { ...settings, ...loaded };
    }
  } catch {
    /* first run */
  }
  // 0.4.0 made the public link the default. Settings written by older versions carry
  // remoteShare:false without the user ever choosing it; switch them once.
  if (!settings.remoteShareChosen) {
    settings.remoteShare = true;
    settings.remoteShareChosen = true;
    saveSettings();
  }
}
function saveSettings(candidate = settings) {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temporary = settingsFile + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(candidate, null, 2));
    fs.renameSync(temporary, settingsFile);
    settings = candidate;
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* original error wins */ }
    throw error;
  }
}

let mainWin = null;

const { createUiPreferences, trustedUiSender, createWelcomeController } = require("./ui-preferences");
const { pathToFileURL } = require("node:url");
const welcomeFile = path.join(__dirname, "welcome.html");
const welcomeUrl = pathToFileURL(welcomeFile).href;
let uiPreferences, welcomeController, welcomeWin = null;
let startupTransition = false, quitting = false;
let welcomeHydrationTimer;
const { probeSetup, ollamaDiskModels, setupOffer, setupChoice, savedSetupAnswer, createOfferGate } = require("./welcome-setup");
/** shown: the welcome's speech-setup step was answered; choice: that answer (install choices or null); rec, installed: what the offer was made from; offered: the offer the step showed. */
const welcomeSetup = { shown: false, choice: null, rec: null, installed: null, offered: null };
// The hardware scan behind the offer waits until the welcome window is on screen (opened in welcome:ready).
const welcomeOffer = createOfferGate(computeWelcomeOffer);
const welcomeSetupOffer = () => welcomeOffer.get();
async function computeWelcomeOffer() {
  const scanStarted = Date.now();
  const info = await localAiInfo(); // await: the scan may become asynchronous (localai.js)
  logLine(`welcome: hardware scan ${Date.now() - scanStarted} ms`);
  const ollama = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const installed = await probeSetup({
    fetchJson: () => fetch(`${ollama}/api/tags`, { signal: AbortSignal.timeout(1500) }).then((r) => (r.ok ? r.json() : null)),
    sherpaReady: () => sttLocal.modelReady(userData),
    // Chromium's CacheStorage for this profile: empty or absent = no Whisper model can be cached yet.
    browserCache: () => {
      const dir = path.join(userData, "Service Worker", "CacheStorage");
      return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
    },
    diskModels: () => ollamaDiskModels(process.env.OLLAMA_MODELS || path.join(os.homedir(), ".ollama", "models"), (d) => fs.readdirSync(d), path.join),
  });
  const { net } = require("electron");
  welcomeSetup.rec = info.recommended;
  welcomeSetup.installed = installed;
  return setupOffer({ hw: info, rec: info.recommended, catalog: localAi.CATALOG, installed, online: !offline && net.isOnline(), installerChose: installChoicesFound });
}

function uiSender(event, welcomeOnly = false) {
  return trustedUiSender(event, {
    welcome: welcomeWin?.webContents,
    pages: [mainWin?.webContents, overlayWin?.webContents, pointsWindow.webContents()].filter(Boolean),
    welcomeUrl, appUrl: APP_URL,
  }, welcomeOnly);
}
// Every renderer-facing channel checks its sender: only the main window and the overlay on the app's
// own origin (uiSender). A page that navigated elsewhere, a subframe or another window gets "Denied".
function appHandle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!uiSender(event)) throw new Error("Denied");
    return fn(event, ...args);
  });
}
function appOn(channel, fn) {
  ipcMain.on(channel, (event, ...args) => { if (uiSender(event)) fn(event, ...args); });
}
// Main-process events that must never be reachable from a renderer.
const internalEvents = new (require("node:events"))();
function initializeUiPreferences() {
  uiPreferences = createUiPreferences({
    app, nativeTheme, systemPreferences, platform: process.platform, execPath: process.execPath,
    portable: !!(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR),
    read: () => settings, save: saveSettings, initial: initialUiSettings,
    canComplete: () => !quitting && !!welcomeWin && !welcomeWin.isDestroyed(),
  });
  welcomeController = createWelcomeController({
    createWindow: createWelcomeWindow,
    complete: () => uiPreferences.complete(),
    isQuitting: () => quitting,
    onFocus: () => uiPreferences.refresh(),
    onFailure: () => {
      clearTimeout(welcomeHydrationTimer);
      dialog.showErrorBox("Filow", sharedText("welcome.loadError", menuLang()));
      app.quit();
    },
    onSaveFailure: result => {
      if (welcomeWin && !welcomeWin.isDestroyed()) void dialog.showMessageBox(welcomeWin, { type: "error", title: "Filow", message: sharedText(result.code, menuLang()) });
    },
    onClosed: () => {
      clearTimeout(welcomeHydrationTimer); welcomeWin = null;
      if (mainWin && !mainWin.isDestroyed() && !quitting) mainWin.focus();
    },
  });
  uiPreferences.subscribe(state => {
    for (const wc of [mainWin, overlayWin, welcomeWin].map((w) => (w && !w.isDestroyed() ? w.webContents : null)).concat(pointsWindow.webContents())) {
      if (!wc) continue;
      if (uiSender({ sender: wc, senderFrame: wc.mainFrame })) wc.send("ui:preferencesChanged", state);
    }
    if (mainWin && !mainWin.isDestroyed()) buildMenu(mainWin);
  });
  // OK Filow's section in Filow Settings: the main window reads and writes the same settings the panel does.
  ipcMain.handle("okfilow:settings:status", event => { if (!uiSender(event)) throw new Error("Denied"); return okFilow ? okFilow.status() : null; });
  ipcMain.handle("okfilow:settings:configure", (event, patch) => { if (!uiSender(event)) throw new Error("Denied"); return okFilow && patch && typeof patch === "object" ? okFilow.applyConfig(patch) : null; });
  ipcMain.on("okfilow:settings:openPanel", event => { if (uiSender(event)) okFilow?.togglePanel(); });
  // FreeLLMAPI's section in Filow Settings (freellm.js). The key travels one way only: page to main.
  ipcMain.handle("freellm:status", event => { if (!uiSender(event)) throw new Error("Denied"); return freeLlm().status(); });
  ipcMain.handle("freellm:configure", (event, patch) => { if (!uiSender(event)) throw new Error("Denied"); return freeLlm().configure(patch); });
  // Dictation's section in Filow Settings (dictation.js). Status needs OK Filow's talk keys for the conflict check.
  ipcMain.handle("dictation:settings:status", event => { if (!uiSender(event)) throw new Error("Denied"); return dictationStatus(); });
  ipcMain.handle("dictation:settings:configure", (event, patch) => {
    if (!uiSender(event)) throw new Error("Denied");
    if (patch && typeof patch === "object") getDictation().configure(patch);
    return dictationStatus();
  });
  ipcMain.handle("ui:getPreferences", event => { if (!uiSender(event)) throw new Error("Denied"); return uiPreferences.get(); });
  ipcMain.handle("ui:updatePreferences", (event, patch) => { if (!uiSender(event)) throw new Error("Denied"); return uiPreferences.update(patch); });
  ipcMain.handle("ui:migratePreferences", (event, patch) => { if (!uiSender(event) || event.sender === welcomeWin?.webContents) throw new Error("Denied"); return uiPreferences.migrateLegacy(patch); });
  for (const key of ["lang", "theme"]) ipcMain.on(`ui:${key}`, (event, value) => {
    if (uiSender(event)) void uiPreferences.update({ [key]: value });
  });
  ipcMain.handle("welcome:complete", event => { if (!uiSender(event, true)) throw new Error("Denied"); return welcomeController.finish(); });
  // First-run guide (docs/welcome/ONBOARDING-V2.md). A first run that reaches the welcome answers the
  // speech-setup question there (or skips it), so offerLocalAi() shows no dialog later.
  ipcMain.handle("welcome:context", event => {
    if (!uiSender(event, true)) throw new Error("Denied");
    const firstRun = settings.welcomeCompleted !== true;
    return { firstRun, askSetup: firstRun && !installChoicesFound && !settings.localAiOffered };
  });
  ipcMain.handle("welcome:setupOffer", event => { if (!uiSender(event, true)) throw new Error("Denied"); return welcomeOfferForStep(); });
  ipcMain.handle("welcome:chooseSetup", (event, accept) => {
    if (!uiSender(event, true) || typeof accept !== "boolean") throw new Error("Denied");
    return chooseWelcomeSetup(accept);
  });
  ipcMain.on("welcome:openMicSettings", event => {
    if (!uiSender(event, true)) return;
    const url = process.platform === "win32" ? "ms-settings:privacy-microphone" : process.platform === "darwin" ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone" : "";
    if (url) void openSystemSettings(url);
  });
  ipcMain.on("welcome:ready", event => {
    if (!uiSender(event, true) || quitting) return;
    onWelcomeReady();
  });
}
/** The welcome is hydrated: show it, and only then let the hardware scan behind the setup step start. */
function onWelcomeReady() {
  clearTimeout(welcomeHydrationTimer);
  welcomeWin.show();
  logLine("welcome: window shown");
  welcomeOffer.open();
}
/** The offer the setup step shows. Remembered: only an offer the user has seen can be accepted. */
async function welcomeOfferForStep() {
  const offer = await welcomeSetupOffer();
  welcomeSetup.offered = offer;
  return offer;
}
/**
 * The setup step's answer. No offer shown (the scan failed and the step said "set up from Settings") =
 * nothing to download, whatever the button said; no second scan here.
 */
function chooseWelcomeSetup(accept) {
  const offer = welcomeSetup.offered;
  welcomeSetup.choice = offer ? setupChoice(offer, welcomeSetup.rec, accept, localAi.CATALOG, welcomeSetup.installed) : null;
  welcomeSetup.shown = true; // answered: closing the window before this step still gets the question later
  // Kept on disk until offerLocalAi() uses it: quitting before the server check must not ask again.
  settings.welcomeSetupAnswer = { choice: welcomeSetup.choice };
  try { saveSettings(); } catch (err) { logLine(`welcome: speech setup answer not saved: ${err.message}`); }
  logLine(`welcome: speech setup ${accept ? "accepted" : "declined"}${welcomeSetup.choice ? ` (${welcomeSetup.choice.models.join(", ")})` : ", nothing to download"}`);
  return { ok: true };
}
function showWelcome() { return welcomeController.show(); }
function createWelcomeWindow() {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const win = new BrowserWindow({
    width: Math.min(1000, area.width), height: Math.min(720, area.height),
    minWidth: Math.min(760, area.width), minHeight: Math.min(540, area.height),
    x: area.x + Math.max(0, Math.floor((area.width - 1000) / 2)),
    y: area.y + Math.max(0, Math.floor((area.height - 720) / 2)),
    title: "Filow", icon: appIcon(), show: false, resizable: true,
    ...(mainWin && !mainWin.isDestroyed() ? { parent: mainWin, modal: false } : {}),
    backgroundColor: uiTheme() === "dark" ? "#121212" : "#f6f7f9",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, "welcome-preload.js") },
  });
  welcomeWin = win;
  win.setMenu(null);
  const fail = () => welcomeController.fail();
  win.webContents.on("will-navigate", event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("render-process-gone", fail);
  win.webContents.on("did-fail-load", fail);
  welcomeHydrationTimer = setTimeout(fail, 15000);
  logLine("welcome: loading");
  void win.loadFile(welcomeFile).catch(fail);
  return win;
}
let selectedSourceId = null;
let pickerWin = null;
let picking = false;

/** Screens and windows the user may watch, minus this app's own window. Thumbnails are small previews for the chooser. */
async function listSources() {
  const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
  const self = mainWin ? mainWin.getMediaSourceId() : "";
  return sources
    .filter((s) => s.id !== self && !/^Filow\b/.test(s.name))
    .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith("screen") ? "screen" : "window", thumbnail: s.thumbnail.isEmpty() ? "" : s.thumbnail.toDataURL() }));
}

/** The display at native resolution as a NativeImage (memory only). */
async function grabDisplay(display) {
  const sf = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) },
  });
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || (sources.length === 1 ? sources[0] : null);
  if (!src || src.thumbnail.isEmpty()) throw new Error("could not capture the display");
  return src.thumbnail;
}

/**
 * Region picker: the display is frozen first (grabbed before the overlay opens, like classic
 * screenshot tools), then shown dimmed with a crosshair, a magnifier and the selection size.
 * Resolves to { display, rect, image } in display-relative CSS px, or null.
 */
async function pickRegion() {
  if (pickerWin || picking) return null;
  picking = true;
  let display, image;
  try {
    display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    image = await grabDisplay(display);
  } finally {
    picking = false;
  }
  const frameUrl = "data:image/jpeg;base64," + image.toJPEG(92).toString("base64");
  return new Promise((resolve) => {
    const { x, y, width, height } = display.bounds;
    pickerWin = new BrowserWindow({
      x, y, width, height,
      frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
      hasShadow: false, enableLargerThanScreen: true, fullscreenable: false, show: false, backgroundColor: "#000000",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "picker-preload.js") },
    });
    guardNavigation(pickerWin);
    ipcMain.handle("picker:frame", (e) => { if (e.sender !== pickerWin?.webContents) throw new Error("Denied"); return { dataUrl: frameUrl }; });
    const finish = (rect) => {
      ipcMain.removeAllListeners("picker:done");
      ipcMain.removeAllListeners("picker:cancel");
      ipcMain.removeHandler("picker:frame");
      const w = pickerWin;
      pickerWin = null;
      if (w && !w.isDestroyed()) w.close();
      resolve(rect ? { display, rect, image } : null);
    };
    ipcMain.on("picker:done", (e, rect) => { if (e.sender === pickerWin?.webContents) finish(rect); });
    ipcMain.on("picker:cancel", (e) => { if (e.sender === pickerWin?.webContents) finish(null); });
    pickerWin.on("closed", () => {
      if (pickerWin) finish(null);
    });
    pickerWin.setAlwaysOnTop(true, "screen-saver");
    pickerWin.loadFile(path.join(__dirname, "picker.html"), { query: { lang: menuLang(), hint: sharedText("shell.picker.hint", menuLang()) } }).then(() => {
      if (!pickerWin) return;
      pickerWin.show();
      pickerWin.focus();
    });
  });
}

/** Crops the chosen rect out of the frozen display (or a fresh grab). JPEG data URL, memory only. */
async function captureRegion(display, rect, image) {
  const img = image || (await grabDisplay(display));
  const { width: iw, height: ih } = img.getSize();
  const kx = iw / display.size.width;
  const ky = ih / display.size.height;
  const crop = {
    x: Math.max(0, Math.round(rect.x * kx)),
    y: Math.max(0, Math.round(rect.y * ky)),
    width: Math.max(1, Math.min(iw, Math.round(rect.width * kx))),
    height: Math.max(1, Math.min(ih, Math.round(rect.height * ky))),
  };
  return "data:image/jpeg;base64," + img.crop(crop).toJPEG(85).toString("base64");
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  if (!settings.screenSense || !settings.screenHotkey) return { ok: true };
  try {
    const ok = globalShortcut.register(settings.screenHotkey, () => mainWin && !mainWin.isDestroyed() && mainWin.webContents.send("screen:hotkey"));
    return ok ? { ok: true } : { ok: false, error: `hotkey ${settings.screenHotkey} is taken by another app` };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function wireScreenSense() {
  const off = () => new Error("Screen Sense is disabled in Settings");
  appHandle("screen:sources", () => (settings.screenSense ? listSources() : Promise.reject(off())));
  appHandle("screen:select", (_e, id) => {
    selectedSourceId = settings.screenSense && typeof id === "string" ? id : null;
  });
  appHandle("screen:pickRegion", async () => {
    if (!settings.screenSense) throw off();
    const picked = await pickRegion();
    if (!picked) return null;
    return { image: await captureRegion(picked.display, picked.rect, picked.image), width: picked.rect.width, height: picked.rect.height };
  });
  // The pairing dialog can switch the public link on/off; the window reloads with the new URLs.
  appOn("remote:set", (_e, on) => {
    if (mainWin && !mainWin.isDestroyed()) void setRemoteShare(mainWin, Boolean(on));
  });
  appHandle("update:status", () => ({ ...updateState, current: app.getVersion() }));
  appOn("update:check", () => void checkForUpdates({ manual: true }));
  appOn("update:install", () => loadUpdater() && updateState.status === "downloaded" && updater.quitAndInstall());
  appOn("take:live", (_e, on) => setTakeLive(on));
  appHandle("remote:status", () => ({ state: tunnels.state, url: tunnels.web, session: tunnels.session, error: tunnels.error, wanted: Boolean(settings.remoteShare) }));
  wireStt();
  appHandle("localai:status", () => localAiState);
  appHandle("net:status", () => {
    const ranked = rankedInterfaces();
    const chosen = ranked.find((i) => i.address === (process.env.FILOW_LAN_IP || lanIp())) || ranked[0] || null;
    return { ip: process.env.FILOW_LAN_IP || lanIp(), iface: chosen ? chosen.name : "", virtual: Boolean(chosen && chosen.score < 0), firewall: firewallStatus(), interfaces: ranked.map((i) => ({ name: i.name, address: i.address, virtual: i.score < 0 })) };
  });
  appHandle("net:allowFirewall", () => allowFirewall());
  appHandle("net:useInterface", (_e, address) => {
    if (mainWin && !mainWin.isDestroyed()) applyMirrorHost(mainWin, typeof address === "string" ? address : "");
    return true;
  });
  appHandle("localai:hardware", () => localAiInfo());
  appOn("localai:install", () => void startOllamaInstall());
  // the script editor's local translation found Ollama stopped: start what is installed, download nothing
  appOn("localai:start", () => startOllamaIfWanted("the editor needs Ollama to translate", { needed: true }));
  appOn("session:report", (_e, info) => {
    if (info && typeof info.code === "string" && typeof info.id === "string") {
      const changedSession = !currentSession || currentSession.id !== info.id;
      currentSession = { id: info.id, code: info.code };
      internalEvents.emit("session:code", info.code);
      // a new session (page reloaded): each open floating window joins it, each with its own code
      if (changedSession && overlayWin && !overlayWin.isDestroyed()) void showOverlay();
      if (changedSession) void pointsWindow.reload();
    }
  });
  appHandle("screen:settings", () => ({ hotkey: settings.screenHotkey, enabled: settings.screenSense }));
  appHandle("screen:setSettings", (_e, next) => {
    if (typeof next.hotkey === "string") settings.screenHotkey = next.hotkey.trim();
    if (typeof next.enabled === "boolean") settings.screenSense = next.enabled;
    saveSettings();
    if (!settings.screenSense) selectedSourceId = null;
    const result = { ...registerHotkey(), hotkey: settings.screenHotkey, enabled: settings.screenSense };
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("screen:settings", { hotkey: settings.screenHotkey, enabled: settings.screenSense });
    return result;
  });
  // getDisplayMedia() in the page resolves to the source chosen in the app's own picker (no Chromium chooser).
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    if (!settings.screenSense || !selectedSourceId) return callback({});
    desktopCapturer
      .getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const src = sources.find((s) => s.id === selectedSourceId);
        callback(src ? { video: src } : {});
      })
      .catch(() => callback({}));
  });
}

function seed(file, fromName) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(seedDir, fromName), file);
}

/** Minimal .env parser: KEY=value lines, # comments, optional quotes. */
// SEC-14: keys typed into .env move to the OS key store (apps/desktop/secrets.js); real environment
// variables still win, as with .env.
function loadSecrets() {
  const { safeStorage } = require("electron");
  const { migrateSecrets } = require("./secrets.js");
  const secrets = migrateSecrets({
    envFile, storeFile: path.join(userData, "secrets.json"), log: logLine,
    fsx: { read: (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null), write: (p, t) => fs.writeFileSync(p, t) },
    crypto: {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s).toString("base64"),
      decrypt: (b) => safeStorage.decryptString(Buffer.from(b, "base64")),
    },
  });
  for (const [k, v] of Object.entries(secrets)) if (v && !(k in process.env)) process.env[k] = v;
}

// FreeLLMAPI (freellm.js): its settings section reads and changes the address, the model and the
// unified key. The key goes to the same encrypted store as the keys typed in .env; a page never gets it back.
let freeLlmSettings;
const freeLlm = () => (freeLlmSettings ||= require("./freellm.js").createFreeLlm({
  getSettings: () => settings,
  saveSettings,
  env: process.env,
  logLine: (line) => logLine(line),
  storeKey: (value) => {
    const { safeStorage } = require("electron");
    return require("./secrets.js").setSecret({
      storeFile: path.join(userData, "secrets.json"),
      fsx: { read: (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null), write: (p, t) => fs.writeFileSync(p, t) },
      crypto: { available: () => safeStorage.isEncryptionAvailable(), encrypt: (s) => safeStorage.encryptString(s).toString("base64") },
    }, require("./freellm.js").KEY_NAME, value);
  },
}));

function loadEnv(file) {
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key && val && !(key in process.env)) process.env[key] = val;
  }
}

/** Adapter names that never carry the phone's Wi-Fi: VMs, Hyper-V/WSL switches, VPNs, Bluetooth. */
const VIRTUAL_IFACE = /virtual|vmware|vmnet|vethernet|hyper-v|wsl|docker|tailscale|zerotier|hamachi|loopback|bluetooth|npcap|host-only|virtualbox|vbox|tun|tap|wireguard|openvpn|cisco|anyconnect|globalprotect|fortissl|pulse/i;
const CGNAT_OR_VBOX = /^(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.168\.56\.|169\.254\.)/;

/** Name of the interface that carries the default route (where the Wi-Fi usually is); "" when unknown. */
let defaultIfaceCache = null;
function defaultIface() {
  if (defaultIfaceCache !== null) return defaultIfaceCache;
  try {
    if (process.platform === "win32") {
      const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-NetRoute -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue | Where-Object { $_.NextHop -ne '0.0.0.0' } | Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1 -ExpandProperty InterfaceAlias"], { encoding: "utf8", timeout: 5000, windowsHide: true });
      defaultIfaceCache = out.trim();
    } else if (process.platform === "darwin") {
      const out = execFileSync("route", ["-n", "get", "default"], { encoding: "utf8", timeout: 3000 });
      defaultIfaceCache = (out.match(/interface:\s*(\S+)/) || [])[1] || "";
    } else {
      const out = execFileSync("sh", ["-c", "ip route show default 2>/dev/null | head -1"], { encoding: "utf8", timeout: 3000 });
      defaultIfaceCache = (out.match(/dev\s+(\S+)/) || [])[1] || "";
    }
  } catch {
    defaultIfaceCache = "";
  }
  return defaultIfaceCache;
}

/** Interfaces ranked for the phone: default-route adapter first, Wi-Fi next, real Ethernet, then the rest; virtual ones last. */
function rankedInterfaces() {
  const def = defaultIface();
  const isPrivate = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  const score = (i) => {
    let s = 0;
    if (def && i.name === def) s += 100;
    if (/wi-?fi|wlan|wireless|en0/i.test(i.name)) s += 40;
    else if (/^ethernet\b|^eth|^en\d/i.test(i.name)) s += 20;
    if (isPrivate(i.address)) s += 10;
    if (VIRTUAL_IFACE.test(i.name) || CGNAT_OR_VBOX.test(i.address)) s -= 200;
    return s;
  };
  return interfaces()
    .map((i) => ({ ...i, score: score(i) }))
    .sort((a, b) => b.score - a.score);
}

function lanIp() {
  const fromEnv = (process.env.FILOW_MIRROR_HOST || "").trim();
  if (fromEnv) return fromEnv;
  if (settings.mirrorHost) return settings.mirrorHost;
  const ranked = rankedInterfaces();
  return ranked[0]?.address || "127.0.0.1";
}

// ---- Windows Firewall: the phone on the Wi-Fi can only reach the local servers (which run inside this
// process) when Filow.exe is allowed in. Adding the rule needs an administrator prompt, once.
const FIREWALL_RULE = "Filow";
function firewallStatus() {
  if (process.platform !== "win32") return "n/a";
  try {
    const out = execFileSync("netsh", ["advfirewall", "firewall", "show", "rule", `name=${FIREWALL_RULE}`], { encoding: "utf8", timeout: 5000, windowsHide: true });
    return /Filow/.test(out) && !/No rules match/i.test(out) ? "ok" : "missing";
  } catch {
    return "missing";
  }
}
function allowFirewall() {
  if (process.platform !== "win32") return Promise.resolve("n/a");
  const exe = process.execPath;
  const args = `advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow program="${exe}" enable=yes profile=any description="Filow: phone mirror and PowerPoint add-in on the local network"`;
  return new Promise((resolve) => {
    // The netsh arguments travel in an environment variable, never spliced into the PowerShell command,
    // so a quote or $ in the install path cannot become code (STANDARDS SEC-16).
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Start-Process -FilePath netsh -ArgumentList $env:FILOW_NETSH_ARGS -Verb RunAs -Wait -WindowStyle Hidden"],
    { windowsHide: true, stdio: "ignore", env: { ...process.env, FILOW_NETSH_ARGS: args } });
    p.on("exit", () => {
      const st = firewallStatus();
      logLine(`firewall rule: ${st}`);
      resolve(st);
    });
    p.on("error", () => resolve(firewallStatus()));
  });
}
function rebuildMenu(win) {
  try {
    buildMenu(win);
  } catch {
    /* menu rebuild is cosmetic */
  }
}
// V2 onboarding: not asked at first start while the public link is on (the default): phones then reach
// Filow over that link and the rule is not needed. The pairing panel shows the firewall state and asks in
// context (pair.firewallAllow), when the user actually pairs over Wi-Fi. This also skips a netsh call
// (up to 5 s on the main thread) on every first start.
async function offerFirewall(win) {
  if (process.platform !== "win32" || settings.remoteShare !== false) { logLine("firewall offer: left to the pairing panel"); return; }
  if (firewallStatus() === "ok") return;
  const tx = (key) => sharedText(`shell.firewall.${key}`, menuLang());
  const { response } = await dialog.showMessageBox(win, { type: "question", title: tx("title"), message: tx("message"), detail: tx("detail"), buttons: [tx("allow"), tx("later")], defaultId: 0, cancelId: 1, noLink: true });
  if (response === 0) await allowFirewall();
}

// ---- Phone on another network: Cloudflare quick tunnel (README "Phone on another network") ----
// `cloudflared tunnel --url` gives a public https URL with no account. One tunnel for the
// web app (the mirror page) and one for the session relay. The QR then carries public URLs,
// so a phone on mobile data pairs like WhatsApp Web. Spend endpoints stay behind the engine
// token; pairing needs the 6-digit code and is rate limited.
const { spawn, execFile, execFileSync } = require("node:child_process");
const https = require("node:https");
const tunnels = { procs: [], web: "", session: "", state: "off", error: "" };

/** Public-link state for the pairing dialog: off | downloading | connecting | on | error. */
function remoteStatus(state, error = "") {
  tunnels.state = state;
  tunnels.error = error;
  logLine(`public link: ${state}${error ? " " + error : ""}`);
  // `session` is the relay address a phone uses with `url`: the page needs both to redraw the pairing QR in place.
  const payload = { state, url: tunnels.web, session: tunnels.session, error };
  internalEvents.emit("remote:status", null, payload);
  if (state === "downloading") splashStatus(st("download"));
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("remote:status", payload);
}

function cloudflaredPath() {
  const bundled = path.join(userData, "bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (fs.existsSync(bundled)) return bundled;
  try {
    const found = execFileSync(process.platform === "win32" ? "where" : "which", ["cloudflared"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
    if (found) return found;
  } catch {
    /* not on PATH */
  }
  return null;
}

// The shared downloader: redirects, idle timeout, length check, and no partial file left on failure.
const { download } = require("./download");

/** Official cloudflared binary from GitHub releases, into <userData>/bin. Asks first. */
// SEC-15: cloudflared is not code-signed, so the download must match the SHA-256 GitHub publishes for
// that release asset; a mismatch (or no published digest) deletes the file and stops.
async function verifyDownload(file, asset) {
  try {
    await require("./integrity.js").verifyGithubAsset(file, "cloudflare/cloudflared", asset);
    logLine(`cloudflared: ${asset} verified`);
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw err;
  }
}
async function ensureCloudflared(win, { silent = false } = {}) {
  const existing = cloudflaredPath();
  if (existing) return existing;
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const base = "https://github.com/cloudflare/cloudflared/releases/latest/download/";
  const asset =
    process.platform === "win32" ? `cloudflared-windows-${arch}.exe` : process.platform === "darwin" ? `cloudflared-darwin-${arch}.tgz` : `cloudflared-linux-${arch}`;
  if (!silent) {
    const { response } = await dialog.showMessageBox(win, {
      type: "question",
      buttons: [mt("tunnelDownload"), sharedText("common.cancel", menuLang())],
      defaultId: 0,
      title: mt("tunnelTitle"),
      message: mt("tunnelMessage"),
      detail: mt("tunnelDetail", { url: base + asset, folder: path.join(userData, "bin") }),
    });
    if (response !== 0) return null;
  }
  remoteStatus("downloading");
  const bin = path.join(userData, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const dest = path.join(bin, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (process.platform === "darwin") {
    const tgz = path.join(bin, asset);
    await download(base + asset, tgz);
    await verifyDownload(tgz, asset);
    execFileSync("tar", ["-xzf", tgz, "-C", bin]);
    fs.rmSync(tgz, { force: true });
  } else {
    await download(base + asset, dest);
    await verifyDownload(dest, asset);
  }
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
  return dest;
}

// On Windows the cloudflared we spawn can be a launcher (a Chocolatey or Scoop shim) that starts the
// real tunnel as its own child: killing only our PID left the tunnel running. Kill the whole tree.
// taskkill takes 0.2 to 1 s per process, and this thread also serves the app's pages: waiting for it
// froze a start whose public link failed by about 2.5 s (no internet, or Cloudflare refusing). So the
// kill is started and not waited for, except with `wait` at quit, where the process must not exit first.
function killTree(pid, { wait = false } = {}) {
  try {
    if (process.platform !== "win32") process.kill(pid);
    else if (wait) execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    return true;
  } catch {
    return false;
  }
}
// A crash or forced close skips will-quit and leaves tunnels to our ports running (tunnels.js).
// Runs once at startup, before any tunnel of ours exists; the listing command is a fixed string.
// startTunnel waits for this sweep, so our own new tunnels can never be mistaken for stale ones.
let tunnelSweep = Promise.resolve();
function killStaleTunnels() {
  const { staleTunnelPids } = require("./tunnels.js");
  tunnelSweep = new Promise((resolve) => {
    const done = (err, out) => {
      if (!err) for (const pid of staleTunnelPids(out, [PORT, SESSION_PORT])) if (killTree(pid)) logLine(`tunnel: closed stale cloudflared ${pid}`);
      resolve();
    };
    if (process.platform === "win32") {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Process -Filter \"name='cloudflared.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"],
      { windowsHide: true, encoding: "utf8", timeout: 15000 }, done);
    } else {
      execFile("ps", ["-eo", "pid=,args="], { encoding: "utf8" }, (err, out) => done(err, String(out || "").replace(/^\s*(\d+)\s+/gm, "$1\t")));
    }
  });
}

function startTunnel(bin, port) {
  return tunnelSweep.then(() => new Promise((resolve, reject) => {
    const p = spawn(bin, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    tunnels.procs.push(p);
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`cloudflared gave no URL for port ${port} within 40 s`)), 40_000);
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited (${code})`));
    });
    p.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  }));
}

/** `wait` only at quit: see killTree. */
function stopTunnels({ wait = false } = {}) {
  for (const p of tunnels.procs) {
    if (!p.pid || !killTree(p.pid, { wait })) {
      try {
        p.kill();
      } catch {
        /* already gone */
      }
    }
  }
  tunnels.procs = [];
  tunnels.web = tunnels.session = "";
  tunnels.state = "off";
  delete process.env.FILOW_PUBLIC_WEB;
  delete process.env.FILOW_PUBLIC_SESSION;
  delete process.env.TRUST_PROXY;
}

/**
 * The public link is on by default (WhatsApp-style pairing: the QR works from any network).
 * `auto` = at start-up: no dialogs, failures only show in the pairing dialog and the app keeps
 * working on the LAN. From the menu or the dialog the user gets the download question and errors.
 */
let remoteBusy = false;
async function setRemoteShare(win, on, { auto = false, reload = true } = {}) {
  if (remoteBusy) return;
  remoteBusy = true;
  stopTunnels();
  settings.remoteShare = on;
  if (!auto) settings.remoteShareChosen = true;
  saveSettings();
  try {
    if (on) {
      try {
        if (offline) throw new Error(mt("tunnelOffline"));
        if (process.env.FILOW_SESSION_URL) throw new Error(mt("tunnelHosted"));
        remoteStatus("connecting");
        const bin = await ensureCloudflared(win, { silent: auto });
        if (!bin) {
          settings.remoteShare = false;
          saveSettings();
          remoteStatus("off");
          buildMenu(win);
          if (reload) win.reload();
          return;
        }
        if (tunnels.state !== "connecting") remoteStatus("connecting"); // back from "downloading"
        const [web, sess] = await Promise.all([startTunnel(bin, PORT), startTunnel(bin, SESSION_PORT)]);
        tunnels.web = web;
        tunnels.session = sess;
        process.env.FILOW_PUBLIC_WEB = web;
        process.env.FILOW_PUBLIC_SESSION = sess;
        process.env.TRUST_PROXY = "1"; // cloudflared sits in front: read the phone's address from cf-connecting-ip
        remoteStatus("on");
      } catch (err) {
        stopTunnels();
        remoteStatus("error", String(err.message || err));
        if (!auto) {
          settings.remoteShare = false;
          saveSettings();
          await errorWithReport(win, mt("tunnelFailed"), String(err.message || err));
        }
        // auto: stay "wanted" so the next launch retries; the LAN QR keeps working meanwhile
      }
    } else {
      remoteStatus("off");
    }
    buildMenu(win);
    if (reload) win.reload(); // the preload re-reads the public URLs; the page creates a fresh session and QR
  } finally {
    remoteBusy = false;
  }
}

/** Which address the QR carries on the LAN: auto, one of the interfaces, or FILOW_MIRROR_HOST from .env. */
function interfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) out.push({ name, address: i.address });
  }
  return out;
}


// ---- PowerPoint add-in on this PC (Windows): HTTPS on localhost + Office developer sideload ----
// Office loads task panes only over HTTPS and only from manifests it knows about. On Windows the
// supported way to register one without an admin catalog is the WEF\Developer registry key (what
// office-addin-dev-settings uses). So: a self-signed localhost certificate trusted by the current
// user, an HTTPS proxy on HTTPS_PORT in front of the two local servers, a manifest in userData,
// and the registry value. PowerPoint then shows "Filow" on the Home tab.
const net = require("node:net");
const HTTPS_PORT = Number(process.env.FILOW_HTTPS_PORT || 4749);
const certDir = path.join(userData, "certs");
const pfxFile = path.join(certDir, "localhost.pfx");
const pemKey = path.join(certDir, "localhost-key.pem");
const pemCert = path.join(certDir, "localhost.pem");
/** Office for Mac loads manifests dropped here (per user, no admin). */
const macWefDir = path.join(os.homedir(), "Library", "Containers", "com.microsoft.Powerpoint", "Data", "Documents", "wef");
const pptManifestFile = path.join(userData, "powerpoint", "manifest.xml");
let httpsProxy = null;
/** The engine page's current session (id + pairing code), served to local views over the HTTPS proxy. */
let currentSession = null;

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || out.trim() || `powershell exited ${code}`))));
  });
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || out.trim() || `${cmd} exited ${code}`))));
  });
}

function haveCert() {
  return process.platform === "win32" ? fs.existsSync(pfxFile) && Boolean(settings.pfxPassword) : fs.existsSync(pemKey) && fs.existsSync(pemCert);
}

/**
 * Self-signed certificate for "localhost", trusted for the current user.
 * Windows: New-SelfSignedCertificate + CurrentUser\Root (one Windows prompt).
 * macOS: openssl + `security add-trusted-cert` into the login keychain (macOS asks for the password once),
 * the same thing office-addin-dev-certs does.
 */
async function ensureLocalhostCert() {
  if (haveCert()) return;
  if (process.platform === "darwin") {
    fs.mkdirSync(certDir, { recursive: true });
    await runCommand("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1825",
      "-keyout", pemKey, "-out", pemCert, "-subj", "/CN=localhost/O=Filow",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-addext", "extendedKeyUsage=serverAuth",
    ]);
    settings.certTrusted = false;
    saveSettings();
    return;
  }
  fs.mkdirSync(certDir, { recursive: true });
  settings.pfxPassword = crypto.randomBytes(12).toString("base64url");
  settings.certTrusted = false;
  saveSettings();
  const ps = `
$ErrorActionPreference = 'Stop'
$cert = New-SelfSignedCertificate -DnsName 'localhost','127.0.0.1' -CertStoreLocation 'Cert:\\CurrentUser\\My' -FriendlyName 'Filow localhost' -NotAfter (Get-Date).AddYears(5) -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048
$pwd = ConvertTo-SecureString -String '${settings.pfxPassword}' -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath '${pfxFile.replace(/'/g, "''")}' -Password $pwd | Out-Null
Export-Certificate -Cert $cert -FilePath '${path.join(certDir, "localhost.cer").replace(/'/g, "''")}' | Out-Null
Write-Output $cert.Thumbprint`;
  await runPowerShell(ps);
}

/**
 * Trust the certificate for the current user. Adding to CurrentUser\Root always goes through a Windows
 * confirmation dialog, which PowerShell -NonInteractive refuses ("user interface not allowed"); certutil
 * shows the dialog itself. Tracked separately so a retry never skips it.
 */
async function ensureCertTrusted() {
  if (settings.certTrusted) return;
  if (process.platform === "darwin") {
    const keychain = path.join(os.homedir(), "Library", "Keychains", "login.keychain-db");
    await runCommand("security", ["add-trusted-cert", "-d", "-r", "trustRoot", "-k", keychain, pemCert]);
    settings.certTrusted = true;
    saveSettings();
    return;
  }
  if (process.platform !== "win32") return;
  const cer = path.join(certDir, "localhost.cer");
  if (!fs.existsSync(cer)) {
    // cer missing but pfx present (older install): re-export it from the user store
    await runPowerShell(`$c = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.FriendlyName -eq 'Filow localhost' -or $_.FriendlyName -eq 'Intelliprompter localhost' } | Select-Object -First 1; if (-not $c) { throw 'certificate not found' }; Export-Certificate -Cert $c -FilePath '${cer.replace(/'/g, "''")}' | Out-Null`);
  }
  await runCommand("certutil.exe", ["-user", "-addstore", "Root", cer]);
  settings.certTrusted = true;
  saveSettings();
}

/** HTTPS → the local servers. /api/session* and /ws go to the relay; everything else to the web app.
 *  Only 127.0.0.1 can connect, so the LAN access password is added for the pane (it runs the engine). */
function startHttpsProxy() {
  if (httpsProxy || !haveCert()) return false;
  const relay = (url) => url.startsWith("/ws/") || url.startsWith("/api/session");
  const hosted = Boolean(process.env.FILOW_SESSION_URL);
  const tls = process.platform === "win32" ? { pfx: fs.readFileSync(pfxFile), passphrase: settings.pfxPassword } : { key: fs.readFileSync(pemKey), cert: fs.readFileSync(pemCert) };
  const server = https.createServer(tls, (req, res) => {
    if (req.url === "/api/local/current-session") {
      // Only reachable from this machine (the proxy listens on 127.0.0.1): the PowerPoint pane joins the app's session.
      const o = req.headers.origin;
      if (o && !/^https:\/\/localhost(:\d+)?$/.test(o)) { res.writeHead(403); res.end(); return; }
      res.writeHead(200, { "Content-Type": "application/json", ...(o ? { "Access-Control-Allow-Origin": o, Vary: "Origin" } : {}) });
      res.end(JSON.stringify(currentSession ?? {}));
      return;
    }
    const toRelay = relay(req.url) && !hosted;
    const headers = { ...req.headers, host: `127.0.0.1:${toRelay ? SESSION_PORT : PORT}` };
    if (toRelay && process.env.ACCESS_PASSWORD && !headers["x-access-password"]) headers["x-access-password"] = process.env.ACCESS_PASSWORD;
    const up = http.request({ host: "127.0.0.1", port: toRelay ? SESSION_PORT : PORT, method: req.method, path: req.url, headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      res.statusCode = 502;
      res.end("upstream unavailable");
    });
    req.pipe(up);
  });
  server.on("upgrade", (req, socket, head) => {
    const port = relay(req.url) && !hosted ? SESSION_PORT : PORT;
    const up = net.connect(port, "127.0.0.1", () => {
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      up.write(raw + "\r\n");
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  server.on("error", (err) => console.warn("https proxy:", err.message));
  server.listen(HTTPS_PORT, "127.0.0.1");
  httpsProxy = server;
  return true;
}

function writeLocalPptManifest() {
  const modulePath = packaged ? path.join(resources, "powerpoint-manifest.js") : path.join(resources, "powerpoint", "scripts", "manifest.js");
  const { buildManifest } = require(modulePath);
  if (!settings.manifestId) settings.manifestId = crypto.randomUUID();
  saveSettings();
  fs.mkdirSync(path.dirname(pptManifestFile), { recursive: true });
  fs.writeFileSync(pptManifestFile, buildManifest(`https://localhost:${HTTPS_PORT}`, { id: settings.manifestId }));
}

/** Registers the manifest with Office for the current user: HKCU key on Windows, the wef folder on macOS. */
async function registerPptManifest() {
  if (process.platform === "darwin") {
    fs.mkdirSync(macWefDir, { recursive: true });
    fs.copyFileSync(pptManifestFile, path.join(macWefDir, "filow.manifest.xml"));
    return;
  }
  const key = "HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer";
  await runPowerShell(`New-Item -Path 'Registry::${key}' -Force | Out-Null; New-ItemProperty -Path 'Registry::${key}' -Name 'Filow' -Value '${pptManifestFile.replace(/'/g, "''")}' -PropertyType String -Force | Out-Null`);
}

async function installPowerPointAddin(win, { silent = false } = {}) {
  if (process.platform !== "win32" && process.platform !== "darwin") {
    if (!silent) dialog.showMessageBox(win, { type: "info", title: "PowerPoint", message: mt("pptWinOnly") });
    return false;
  }
  try {
    await ensureLocalhostCert();
    await ensureCertTrusted();
    startHttpsProxy();
    writeLocalPptManifest();
    await registerPptManifest();
    settings.pptInstalled = true;
    saveSettings();
    buildMenu(win);
    if (!silent) dialog.showMessageBox(win, { type: "info", title: "PowerPoint", message: mt("pptInstalled") });
    return true;
  } catch (err) {
    settings.pptInstalled = false;
    saveSettings();
    if (!silent) await errorWithReport(win, mt("pptInstallFailed"), String(err.message || err));
    return false;
  }
}

async function uninstallPowerPointAddin(win) {
  try {
    if (process.platform === "darwin") fs.rmSync(path.join(macWefDir, "filow.manifest.xml"), { force: true });
    else await runPowerShell(`Remove-ItemProperty -Path 'Registry::HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer' -Name 'Filow' -ErrorAction SilentlyContinue`);
  } catch {
    /* already gone */
  }
  settings.pptInstalled = false;
  saveSettings();
  buildMenu(win);
  dialog.showMessageBox(win, { type: "info", title: "PowerPoint", message: mt("pptRemoved") });
}


// ---- Automatic updates (README "Automatic updates") ----
// electron-updater is bundled into vendor/electron-updater.js (workspace hoisting keeps it out of
// the asar otherwise). The feed is a PUBLIC GitHub repo that holds only the installers, because an
// app cannot read a private repo's releases without shipping a token. Checks run at start-up and
// from the menu; the download happens in the background and the user chooses when to restart.
let updater = null;
let updateState = { status: "idle", version: "", error: "" }; // idle | checking | available | downloading | downloaded | none | error
// An update never interrupts a talk (SIGN-04). The page reports when a take starts and stops. An
// update that finishes downloading during a take, or while a PowerPoint slideshow runs, raises no
// notification and no dialog, and they are not shown later either: the page shows its "restart"
// banner once the take ends, the menu offers the restart, and the update is installed when the app
// quits.
let takeLive = false;
function setTakeLive(on) {
  const live = on === true; // the value comes from a page: anything else is not a take
  if (live === takeLive) return;
  takeLive = live;
  logLine(takeLive ? "take: live" : "take: ended");
}
// The page that reported the take is gone (another page loaded, it crashed, the window closed): the
// take went with it. Without this the flag would stay set and silence update prompts for good.
function endTakeWithPage(win) {
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) setTakeLive(false);
  });
  win.webContents.on("render-process-gone", () => setTakeLive(false));
  win.on("closed", () => setTakeLive(false));
}

function loadUpdater() {
  if (updater !== null) return updater;
  try {
    const mod = require(path.join(__dirname, "vendor", "electron-updater.js"));
    updater = mod.autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.logger = null;
    updater.on("checking-for-update", () => setUpdateState({ status: "checking" }));
    updater.on("update-available", (info) => setUpdateState({ status: "downloading", version: info.version }));
    updater.on("update-not-available", () => setUpdateState({ status: "none" }));
    updater.on("error", (err) => setUpdateState({ status: "error", error: String((err && err.message) || err).slice(0, 200) }));
    updater.on("update-downloaded", (info) => {
      setUpdateState({ status: "downloaded", version: info.version });
      if (takeLive || slideShow.running) {
        logLine("update: ready, no prompt (a take or a slideshow is live)");
        return;
      }
      // System notification as well, for when the app sits behind other windows.
      try {
        if (Notification.isSupported()) {
          const n = new Notification({ title: mt("updateReady", { version: info.version }), body: mt("updateReadyDetail"), icon: appIcon() });
          n.on("click", () => {
            if (mainWin && !mainWin.isDestroyed()) {
              mainWin.show();
              mainWin.focus();
            }
          });
          n.show();
        }
      } catch {
        /* no notification support */
      }
      if (mainWin && !mainWin.isDestroyed()) {
        dialog
          .showMessageBox(mainWin, {
            type: "info",
            buttons: [mt("updateRestart"), mt("updateLater")],
            defaultId: 0,
            title: "Filow",
            message: mt("updateReady", { version: info.version }),
            detail: mt("updateReadyDetail"),
          })
          .then(({ response }) => {
            if (response === 0) updater.quitAndInstall();
          });
      }
    });
  } catch (err) {
    updater = false;
    setUpdateState({ status: "error", error: String(err.message || err) });
  }
  return updater;
}

function setUpdateState(next) {
  updateState = { ...updateState, ...next };
  logLine(`update: ${updateState.status}${updateState.version ? " " + updateState.version : ""}${updateState.error ? " " + updateState.error : ""}`);
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send("update:status", { ...updateState, current: app.getVersion() });
    buildMenu(mainWin);
  }
}

async function checkForUpdates({ manual = false } = {}) {
  // Unpacked (--dir) builds ship no update feed: checking would only report an error.
  if (!packaged || !fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))) {
    if (manual) dialog.showMessageBox(mainWin, { type: "info", title: "Filow", message: mt("updateInstalledOnly") });
    return;
  }
  if (offline) {
    if (manual) dialog.showMessageBox(mainWin, { type: "info", title: "Filow", message: mt("updateOffline") });
    return;
  }
  const u = loadUpdater();
  if (!u) return;
  try {
    const r = await u.checkForUpdates();
    if (manual && r && r.updateInfo && r.updateInfo.version === app.getVersion()) {
      dialog.showMessageBox(mainWin, { type: "info", title: "Filow", message: mt("updateNone", { version: app.getVersion() }) });
    }
  } catch (err) {
    if (manual) dialog.showMessageBox(mainWin, { type: "warning", title: "Filow", message: mt("updateFailed"), detail: String(err.message || err) });
  }
}


// ---- Splash screen and first-start choices from the installer ----
let splash = null;
let splashShownAt = 0;
const SPLASH_MIN_MS = Number(process.env.FILOW_SPLASH_MIN_MS || 1800);
/** Plain-text startup log in userData (startup.log): which step ran, and any error the splash or link hit. */
// A crashed renderer leaves a dead window mid-talk. Reload it; the take's state lives in the main
// process and the session server, so the page picks it up again. At most 3 reloads a minute per
// window, so a page that crashes on load does not spin forever.
function reloadOnCrash(win, name) {
  const recent = [];
  win.webContents.on("render-process-gone", (_e, d) => {
    if (quitting || d.reason === "clean-exit" || win.isDestroyed()) return;
    const now = Date.now();
    while (recent.length && now - recent[0] > 60_000) recent.shift();
    recent.push(now);
    if (recent.length > 3) return logLine(`CRASH ${name}: ${d.reason} again, not reloading (3 reloads in a minute)`);
    logLine(`CRASH ${name}: ${d.reason}, reloading`);
    setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 300);
  });
}

function logLine(msg) {
  try {
    fs.appendFileSync(path.join(userData, "startup.log"), `${new Date().toISOString()} ${msg}
`);
  } catch {
    /* ignore */
  }
}
function uiTheme() {
  const t = settings.theme === "light" || settings.theme === "dark" ? settings.theme : null;
  return t || (nativeTheme.shouldUseDarkColors ? "dark" : "light");
}
function showSplash() {
  const local = offline || (process.env.DECISION_PROVIDER || "").startsWith("clef-local");
  splash = new BrowserWindow({
    width: 460, height: 440, frame: false, resizable: false, show: false, alwaysOnTop: false, skipTaskbar: false,
    backgroundColor: uiTheme() === "dark" ? "#121212" : "#f6f7f9", title: "Filow",
    icon: appIcon(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const lang = menuLang();
  // The page has no dictionary of its own: its texts come translated in the query.
  const q = new URLSearchParams({ v: app.getVersion(), theme: uiTheme(), lang, tagline: sharedText("app.tagline", lang),
    badge: sharedText(local ? "shell.splash.local" : "shell.splash.guard", lang) });
  splashShownAt = Date.now();
  guardNavigation(splash);
  splash.on("closed", () => (splash = null));
  // Shown at first paint (ready-to-show), not after the whole load; resolves once it is on screen.
  const w = splash;
  const shown = new Promise((resolve) => {
    const show = () => {
      if (!w.isDestroyed() && !w.isVisible()) {
        w.show();
        logLine(`splash shown (${Math.round(performance.now())} ms after process start)`);
      }
      resolve();
    };
    w.once("ready-to-show", show);
    w.loadFile(path.join(__dirname, "splash.html"), { query: Object.fromEntries(q) })
      .then(show)
      .catch((err) => { logLine(`splash failed: ${err && err.message ? err.message : err}`); resolve(); });
  });
  return shown;
}
function splashStatus(text, done = false) {
  if (!splash || splash.isDestroyed()) return;
  splash.webContents.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(text)}, ${done ? "true" : "false"})`).catch(() => undefined);
}
function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close();
  splash = null;
}
const st = (key) => sharedText(`shell.splash.${key}`, menuLang());

/** install-choices.json is written by the Windows installer (build/installer.nsh): language and models to fetch. */
let installChoicesFound = false;
function readInstallChoices() {
  const file = path.join(userData, "install-choices.json");
  try {
    if (!fs.existsSync(file)) return null;
    const choices = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.rmSync(file, { force: true });
    installChoicesFound = true; // the welcome then skips its speech-setup step: the installer already asked
    // Installer locale is inferred, not an explicit UI language preference.
    return choices;
  } catch {
    return null;
  }
}


// ---- Presenting: follow the slide show and show the presenter overlay ----
const { watchSlideShow } = require("./slideshow");

/** Window/taskbar icon: on Windows the multi-size .ico (compact mark at small sizes), elsewhere the PNG. */
function appIcon() {
  return path.join(__dirname, "build", process.platform === "win32" ? "icon.ico" : "icon.png");
}

// ---- Dictation: speak into any app's text field, on this PC only (dictation.js, docs/okfilow/DICTATION.md) ----
let s1 = null;
/** The local runtime for S1-mini by Superwhisper (s1-runtime.js): started at the first English dictation. */
function s1Runtime() {
  s1 ||= require("./s1-runtime").createS1Runtime({ userData, logLine, spawn: require("node:child_process").spawn, threads: () => Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2))) });
  return s1;
}
app.on("will-quit", () => { if (s1) s1.stop(); });
let dictation = null;
function getDictation() {
  if (dictation) return dictation;
  const { clipboard, ClipboardItem, BrowserWindow: BW, systemPreferences, dialog: dlg } = require("electron");
  dictation = require("./dictation").createDictation({
    text: (key) => sharedText(key, menuLang()),
    getSettings: () => settings,
    saveSettings,
    logLine,
    clipboard,
    ClipboardItem,
    BrowserWindow: BW,
    systemPreferences,
    dialog: dlg,
    openSystemSettings,
    screenReader: () => app.isAccessibilitySupportEnabled(),
    // The phrase models ("questions") are the ones made for short utterances; "auto" follows the speech language.
    modelReady: language => sttLocal.modelReady(userData, { use: "questions", language: language === "auto" ? sttLanguage() : language }),
    // Windows: our own small helper reads which window has the keyboard (program, window class, administrator,
    // password box) and sends the keys, so Filow knows whether Windows took them. Null on other systems.
    target: () => require("./dictation-target").loadTarget(),
    // English dictations are written out by S1-mini by Superwhisper on this PC (dictation-cleanup.js,
    // s1-runtime.js). Without the model or the runtime the step is skipped and the report says why.
    cleaner: require("./dictation-cleanup").createCleaner({ run: (body, signal) => s1Runtime().run(body, signal), ready: () => s1Runtime().ready(), budgetMs: () => 700 }),
    cleanupStatus: () => s1Runtime().status(),
    // Ctrl + V (Command + V on macOS) through OK Filow's own keyboard hook: uiohook-napi (MIT) sends it with
    // SendInput on Windows, CGEvent on macOS and XTest on X11. No shell, no PowerShell, no extra native module.
    sendPaste: hook => {
      const { UiohookKey: K } = require("./uiohook").loadUiohook();
      hook.keyTap(K.V, [process.platform === "darwin" ? K.Meta : K.Ctrl]);
    },
  });
  return dictation;
}
function dictationStatus() {
  const ok = okFilow ? okFilow.status() : null;
  return getDictation().status({ talkHotkey: ok ? ok.hotkey : "", hook: ok ? ok.hook === "hold" : false });
}

// ---- OK Filow: push-to-talk screen helper (okfilow.js, docs/BUDDY-PLAN.md) ----
let okFilow = null;
function startOkFilow() {
  if (okFilow) return;
  try {
    okFilow = require("./okfilow").createOkFilow({
      appUrl: APP_URL,
      getSettings: () => settings,
      saveSettings,
      iconPath: path.join(__dirname, "build", "icon.png"),
      logLine,
      sttLocal: sttLocal.forUse("questions", sttLanguage),
      userData,
      menuText: (k) => mt(k),
    // macOS: the plain-words prompt that opens the right System Settings pane (mac-permissions.js).
    askKeyboardPermission: require("./mac-permissions").createKeyboardPermissionPrompt({ dialog, systemPreferences, openSystemSettings, menuText: (k) => mt(k), logLine }),
      isOffline: () => offline,
      // A link from the OK Filow panel to one of Filow's own settings pages opens in the main window, where
      // the settings can be changed (the system browser has no desktop bridge). Never during a take.
      openAppPage: (url) => {
        if (!mainWin || mainWin.isDestroyed() || takeLive || !isAppPage(url)) return false;
        void mainWin.loadURL(url);
        mainWin.show();
        mainWin.focus();
        return true;
      },
      sttDownload: () => void sttDownload(),
      // a question found Ollama stopped: start it in the background, so the next question is answered
      onAnswerError: (failure) => { if (localAi.isOllamaStopped(failure)) startOllamaIfWanted("OK Filow found Ollama stopped", { needed: true }); },
      dictation: getDictation(),
    });
    okFilow.start();
  } catch (err) {
    okFilow = null;
    logLine(`okfilow failed to start: ${err && err.stack ? err.stack : err}`);
  }
}

// ---- Speech-to-text on this PC (stt.js + stt-worker.js) ----
// The spoken language (auto, en, it, ru, ro, ja) picks the model; the page sets it from Settings
// and with every take, and OK Filow's questions use the same one.
const sttLocal = require("./stt");
let sttSession = null;
let sttJob = null; // the download in flight or the last one that failed: {key, state, pct, error}
function sttLanguage() {
  return sttLocal.normaliseLanguage(settings.speechLanguage);
}
function setSttLanguage(language) {
  if (typeof language !== "string") return;
  const lang = sttLocal.normaliseLanguage(language);
  if (lang !== sttLanguage()) saveSettings({ ...settings, speechLanguage: lang });
}
function sttStatus() {
  return { ...sttLocal.speechStatus(userData, { language: sttLanguage(), job: sttJob }), running: Boolean(sttSession && sttSession.ready) };
}
function sttBroadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}
let sttDownloading = null;
/**
 * Downloads, with the user's consent given by the button, what the spoken language needs: the model
 * for following a talk, or with use "questions" the more accurate one for OK Filow questions.
 */
function sttDownload(use = "tracking") {
  const status = sttStatus();
  const key = use === "questions" ? status.questions.wanted : status.wanted;
  if (process.env.FILOW_OFFLINE === "1") {
    sttJob = { key, state: "error", pct: 0, error: sharedText("offline.downloadDisabled", menuLang()) };
    sttBroadcast("stt:status", sttStatus());
    return Promise.resolve();
  }
  if (sttDownloading) {
    // Another language's model is still coming: fetch this one right after it instead of ignoring the click.
    if (sttJob && sttJob.key !== key) void sttDownloading.then(() => sttDownload(use));
    return sttDownloading;
  }
  sttDownloading = sttLocal
    .ensureAll(userData, sttLocal.requiredSpecs(key), (s) => {
      sttJob = { key, state: s.state, pct: s.pct, error: s.error || "" };
      logLine(`stt model ${s.model || key}: ${s.state}${s.pct ? ` ${s.pct}%` : ""}${s.message ? ` ${s.message}` : ""}${s.error ? ` ${s.error}` : ""}`);
      sttBroadcast("stt:status", sttStatus());
    })
    .finally(() => {
      sttDownloading = null;
    });
  return sttDownloading;
}
function wireStt() {
  appHandle("stt:status", () => sttStatus());
  appHandle("stt:language", (_e, language) => {
    setSttLanguage(language);
    return sttStatus();
  });
  appOn("stt:download", (_e, language, use) => {
    setSttLanguage(language);
    void sttDownload(use === "questions" ? "questions" : "tracking");
  });
  appHandle("stt:remove", () => {
    if (sttSession) sttSession.dispose();
    sttSession = null;
    sttJob = null;
    sttLocal.removeModel(userData);
    sttBroadcast("stt:status", sttStatus());
  });
  appHandle("stt:start", async (e, language) => {
    setSttLanguage(language);
    if (!sttSession) sttSession = new sttLocal.SttSession(userData, logLine, { use: "tracking", getLanguage: sttLanguage });
    const wc = e.sender;
    sttSession.onResult = (r) => !wc.isDestroyed() && wc.send("stt:result", { partial: r.partial, committed: r.committed });
    sttSession.onError = (m) => !wc.isDestroyed() && wc.send("stt:result", { partial: "", committed: "", error: m });
    const out = await sttSession.start(typeof language === "string" ? language : "auto");
    sttBroadcast("stt:status", sttStatus());
    return out;
  });
  appOn("stt:feed", (_e, samples) => {
    if (sttSession) sttSession.feed(samples instanceof Float32Array ? samples : new Float32Array(samples));
  });
  appHandle("stt:stop", () => sttSession?.stop());
}

// ---- Local AI: hardware scan, recommendation, unattended Ollama install (localai.js) ----
const localAi = require("./localai");
let localAiState = { state: "idle", pct: 0, error: "", version: "", command: "" };
let localAiHardware = null;
let localAiInstalling = null;
/** The hardware scan and its recommendation; a promise (the scan runs off the main thread), made once. */
function localAiInfo() {
  if (!localAiHardware) localAiHardware = localAi.hardwareScan().then((hw) => ({ ...hw, recommended: localAi.recommend(hw) }));
  return localAiHardware;
}
function setLocalAi(s) {
  localAiState = s;
  logLine(`local AI: ${s.state}${s.pct ? ` ${s.pct}%` : ""}${s.code ? ` [${s.code}]` : ""}${s.error ? ` ${s.error}` : ""}`);
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("localai:status", s);
}
/** What the start of Ollama writes in the startup log (the reason it did not start: exit code, the end of its own logs), masked like a report. */
function localAiLog(line) {
  let user = "";
  try { user = os.userInfo().username; } catch { /* no user info */ }
  logLine(`local AI: ${diag.redact(line, { home: os.homedir(), user })}`);
}
/** QA builds only: FILOW_QA_OLLAMA_EXE=<ollama.exe> stands in for the installed Ollama (with OLLAMA_URL on a spare port). */
function localAiDeps() {
  const qaExe = process.env.FILOW_QA_OLLAMA_EXE && require("./qa.js").isQaBuild(app) ? process.env.FILOW_QA_OLLAMA_EXE : "";
  return { log: localAiLog, ...(qaExe ? { findExe: () => qaExe } : {}) };
}
/**
 * Installs Ollama if it is missing, then starts it and waits for it. `startOnly`: never download, only
 * start an Ollama that is installed (when Filow opens, or when OK Filow finds it stopped).
 */
function startOllamaInstall({ startOnly = false } = {}) {
  if (!startOnly && process.env.FILOW_OFFLINE === "1") {
    setLocalAi({ ...localAiState, state: "error", pct: 0, code: "", error: sharedText("offline.downloadDisabled", menuLang()) });
    return Promise.resolve();
  }
  if (localAiInstalling) return localAiInstalling;
  if (!startOnly && !settings.ollamaWanted) {
    // the user asked Filow for Ollama once: from now on Filow starts it when it opens
    settings.ollamaWanted = true;
    saveSettings();
  }
  localAiInstalling = Promise.resolve()
    .then(() => localAi.installOllama(path.join(userData, "bin"), setLocalAi, { ...localAiDeps(), startOnly }))
    .catch((err) => {
      // whatever went wrong, the status may not stay on "starting"
      setLocalAi({ state: "error", pct: 0, code: "unexpected", error: String(err && err.message ? err.message : err), version: "", command: "" });
    })
    .finally(() => {
      localAiInstalling = null;
    });
  return localAiInstalling;
}
/**
 * An installed Ollama that is not answering is started in the background, without a question: when
 * Filow opens (only once the user has asked Filow for Ollama) and when OK Filow needed it and found
 * it stopped (`needed`). Nothing is downloaded here.
 */
function startOllamaIfWanted(why, { needed = false } = {}) {
  if ((!needed && !settings.ollamaWanted) || localAiInstalling || !localAi.ollamaIsLocal()) return;
  logLine(`local AI: start check (${why})`);
  void startOllamaInstall({ startOnly: true });
}
/** First start without installer choices (macOS, Linux, portable): offer the hardware-based setup. */
async function offerLocalAi() {
  // V2 onboarding: the welcome asked in its "This computer" step (or the user skipped it); no second question.
  // The answer may come from an earlier launch that quit before getting here (settings.welcomeSetupAnswer).
  const saved = savedSetupAnswer(settings.welcomeSetupAnswer, localAi.CATALOG);
  if (!welcomeSetup.shown && saved) Object.assign(welcomeSetup, { shown: true, choice: saved.choice });
  delete settings.welcomeSetupAnswer; // main() saves settings (localAiOffered) right after this returns
  if (welcomeSetup.shown) {
    logLine(`local AI offer: answered in the welcome${welcomeSetup.choice ? "" : " (nothing to download)"}`);
    return welcomeSetup.choice;
  }
  const info = await localAiInfo();
  const rec = info.recommended;
  if (!rec.models.length) return null;
  const tx = (key, vars) => sharedText(`shell.localAi.${key}`, menuLang(), vars);
  const machine = [tx("machine", { ram: info.ramGb }), info.gpu, info.freeGb >= 0 ? tx("free", { gb: info.freeGb }) : ""].filter(Boolean).join(" · ");
  const recommended = [tx("recommended", { models: rec.models.map((n) => sharedText(`catalog.${n}`, menuLang())).join(", ") }), rec.ollama ? tx("ollama") : ""].filter(Boolean).join("\n");
  // Owned by the splash when it is up: an unowned box opened behind the splash (seen 2026-11-09).
  const owner = splash && !splash.isDestroyed() ? splash : null;
  const options = {
    type: "question",
    title: tx("title"),
    message: tx("message", { device: tx(info.platform === "darwin" ? "mac" : "pc"), gb: rec.downloadGb }),
    detail: [machine, recommended, tx("after")].join("\n\n"),
    buttons: [tx("install"), tx("later")],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  logLine(`local AI offer: ${response === 0 ? "install" : "not now"}`);
  return response === 0 ? { models: rec.models, ollama: rec.ollama } : null;
}

const { createFloatingWindow, createPointsWindow } = require("./points-window");
let overlayWin = null;
let stopSlideShowWatch = null;
let slideShow = { running: false, index: -1, total: 0, title: "" };

function overlayUrl(code = currentSession ? currentSession.code : "") {
  // The overlay is a compact phone-mirror view of the app's own session: nothing to pair, auto-accepted as a local peer.
  return `${APP_URL}/mirror?compact=1&overlay=1${code ? `&code=${code}` : ""}`;
}

/**
 * A pairing code nobody has used yet. Codes are single use and a floating window spends one when it
 * joins, while the page renews its code only after a pairing it has to approve: so before a floating
 * window (re)joins, the page is asked for a new code (preload onNeedCode). Falls back to the current
 * code when the page does not answer in time.
 */
let codeQueue = Promise.resolve();
function freshSessionCode() {
  // One at a time: a new code replaces the last one on the server, so the next window asks only once
  // the previous one has joined with its code (session:codeSpent) or after a few seconds.
  const turn = codeQueue.then(() => requestSessionCode());
  codeQueue = turn.then(() => waitInternal("codeSpent", 6000));
  return turn;
}
function waitInternal(event, timeoutMs) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      internalEvents.off(event, done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    internalEvents.on(event, done);
  });
}
function requestSessionCode(timeoutMs = 2500) {
  const before = currentSession ? currentSession.code : "";
  if (!mainWin || mainWin.isDestroyed()) return Promise.resolve(before);
  return new Promise((resolve) => {
    const done = (code) => {
      clearTimeout(timer);
      internalEvents.off("session:code", onCode);
      resolve(code);
    };
    const onCode = (code) => { if (code && code !== before) done(code); };
    const timer = setTimeout(() => done(currentSession ? currentSession.code : ""), timeoutMs);
    internalEvents.on("session:code", onCode);
    mainWin.webContents.send("session:needCode");
  });
}

let overlayOpening = null;
function showOverlay() {
  overlayOpening = overlayOpening || openOverlay().finally(() => (overlayOpening = null));
  return overlayOpening;
}
async function openOverlay() {
  const code = await freshSessionCode();
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.show();
    overlayWin.loadURL(overlayUrl(code));
    return;
  }
  const b = settings.overlayBounds || {};
  overlayWin = createFloatingWindow(floatingDeps(), {
    name: "overlay",
    title: "Filow overlay",
    url: overlayUrl(code),
    bounds: { width: b.width || 440, height: b.height || 360, x: b.x, y: b.y },
    background: uiTheme() === "dark" ? "#121212" : "#f6f7f9",
    opacity: settings.overlayOpacity || 0.94,
    hidden: settings.overlayHidden,
    saveBounds: (bounds) => {
      settings.overlayBounds = bounds;
      saveSettings();
    },
    onClosed: () => (overlayWin = null),
  });
  buildMenu(mainWin);
}

// The points window for calls (points-window.js): the same floating window as the overlay, its own
// switch in the menu and in the Display panel, always left out of screen sharing where the system can.
function floatingDeps() {
  return { BrowserWindow, preload: path.join(__dirname, "preload.js"), reloadOnCrash, guardNavigation, onFocus: () => uiPreferences?.refresh() };
}
const pointsWindow = createPointsWindow({
  ...floatingDeps(),
  screen: { getAllDisplays: () => screen.getAllDisplays(), getPrimaryDisplay: () => screen.getPrimaryDisplay() },
  platform: process.platform,
  appUrl: APP_URL,
  sessionCode: () => (currentSession ? currentSession.code : ""),
  freshCode: () => freshSessionCode(),
  background: () => uiTheme() === "dark" ? "#121212" : "#f6f7f9",
  bounds: () => settings.pointsBounds,
  saveBounds: (bounds) => {
    settings.pointsBounds = bounds;
    saveSettings();
  },
  onChange: (open) => {
    if (mainWin && !mainWin.isDestroyed()) {
      buildMenu(mainWin);
      mainWin.webContents.send("points:changed", { open });
    }
  },
});

function hideOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close();
  overlayWin = null;
  buildMenu(mainWin);
}

function startSlideShowWatch() {
  if (stopSlideShowWatch) return;
  stopSlideShowWatch = watchSlideShow((s) => {
    const wasRunning = slideShow.running;
    slideShow = { running: Boolean(s.running), index: typeof s.index === "number" ? s.index : -1, total: Number(s.total || 0), title: String(s.title || "") };
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("slideshow", slideShow);
    if (slideShow.running && !wasRunning && settings.overlayAuto !== false) showOverlay();
    if (!slideShow.running && wasRunning && settings.overlayAuto !== false) hideOverlay();
  });
}

/** Writes an Office manifest for the public HTTPS origin the pane is reachable at (README "PowerPoint add-in"). */
async function savePowerPointManifest(win) {
  const fromEnv = (process.env.PUBLIC_ORIGIN || "").trim();
  const origin = tunnels.web || (fromEnv.startsWith("https://") ? fromEnv : "");
  if (!origin) {
    dialog.showMessageBox(win, { type: "info", title: "PowerPoint", message: mt("pptNoOrigin") });
    return;
  }
  if (!settings.manifestId) {
    settings.manifestId = crypto.randomUUID();
    saveSettings();
  }
  const modulePath = packaged ? path.join(resources, "powerpoint-manifest.js") : path.join(resources, "powerpoint", "scripts", "manifest.js");
  const { buildManifest } = require(modulePath);
  const { filePath } = await dialog.showSaveDialog(win, {
    title: mt("pptManifest"),
    defaultPath: path.join(app.getPath("documents"), "Filow.manifest.xml"),
    filters: [{ name: "Office manifest", extensions: ["xml"] }],
  });
  if (!filePath) return;
  fs.writeFileSync(filePath, buildManifest(origin, { id: settings.manifestId }));
  dialog.showMessageBox(win, { type: "info", title: "PowerPoint", message: mt("pptSaved", { origin }) });
}

function applyMirrorHost(win, host) {
  settings.mirrorHost = host;
  saveSettings();
  process.env.FILOW_LAN_IP = host || lanIp();
  process.env.PUBLIC_ORIGIN = `http://${process.env.FILOW_LAN_IP}:${PORT}`;
  buildMenu(win);
  win.reload();
}


function startServers() {
  const hosted = Boolean(process.env.FILOW_SESSION_URL);
  const bind = hosted ? "127.0.0.1" : "0.0.0.0";
  if (!hosted) {
    // LAN mode: gate the spend endpoints with a per-launch secret that only this window knows.
    process.env.ACCESS_PASSWORD = crypto.randomBytes(16).toString("base64url");
    process.env.AUTO_ACCEPT_LAN = "1"; // phones on this Wi-Fi join without a prompt; tunnel peers are asked
    process.env.FILOW_LAN_IP = lanIp();
  }
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = bind;
  process.env.SESSION_PORT = String(SESSION_PORT);
  process.env.SESSION_HOST = bind;
  process.env.NODE_ENV = "production";
  process.env.FILOW_SCRIPT = scriptFile;
  process.env.PUBLIC_ORIGIN = `http://${process.env.FILOW_LAN_IP || "127.0.0.1"}:${PORT}`;
  const title = process.title;
  require(webServer); // Next's standalone server starts listening when required
  process.title = title; // Next renames the process "next-server"; on Linux and macOS ps, pkill and System Monitor would not find Filow
  if (!hosted) require(sessionServer); // relay in-process; hosted mode uses the remote one
  const probe = /^([^:]+):(\d+)$/.exec(process.env.FILOW_QA_PROBE_SERVER_OUTBOUND || "");
  if (probe && require("./qa.js").isQaBuild(app)) {
    require("node:net").connect({ host: probe[1], port: Number(probe[2]) })
      .on("connect", function () { this.destroy(); })
      .on("error", () => {});
  }
}

function waitFor(url, tries = 100) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const retry = () => (n > 0 ? setTimeout(() => attempt(n - 1), 150) : reject(new Error(`server did not start: ${url}`)));
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      // A socket that connects but never answers would otherwise hold the splash forever.
      req.setTimeout(3000, () => req.destroy(new Error("timeout")));
      req.on("error", retry);
    };
    attempt(tries);
  });
}

// Startup stages go to startup.log so a launch that never shows its window says where it stopped,
// and a watchdog opens the window anyway instead of leaving the user on the splash.
let startupStage = "starting";
function stage(name) {
  startupStage = name;
  logLine(`startup: ${name} (${Math.round(performance.now())} ms)`);
}
const STARTUP_WATCHDOG_MS = 90000;

/**
 * Offline mode: every provider becomes local and the renderer can only reach this
 * machine (the local servers and Ollama). Toggled from the menu; the server-side
 * provider resolution reads the same flag through process.env.
 */
let offline = process.env.FILOW_OFFLINE === "1";
function applyOffline(win, value = process.env.FILOW_OFFLINE === "1") {
  offline = value;
  process.env.FILOW_OFFLINE = value ? "1" : "";
  if (offline) stopTunnels();
  const filter = { urls: ["*://*/*", "ws://*/*", "wss://*/*"] };
  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    if (!offline) return callback({});
    const host = (() => {
      try {
        return new URL(details.url).hostname;
      } catch {
        return "";
      }
    })();
    const local = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === process.env.FILOW_LAN_IP;
    // (the HTTPS proxy on localhost:HTTPS_PORT is covered by "localhost")
    callback({ cancel: !local });
  });
  win?.webContents.send("offline", offline);
}

// ---- Diagnostics: crashes go to startup.log; "Report a problem" makes a file the user saves ----
const diag = require("./diag");
// Filow sends nothing by itself: the report window (about.js) shows every line of the masked report and
// saves it to a file the user picks. It leaves this PC only when the user presses "Open an issue on
// GitHub" there, after the notice that issues are public (docs/okfilow/OUTBOUND.md row 16).
process.on("uncaughtException", (err) => logLine(`CRASH main: ${err && err.stack ? err.stack : err}`));
process.on("unhandledRejection", (err) => logLine(`CRASH main (promise): ${err && err.stack ? err.stack : err}`));
app.on("render-process-gone", (_e, _wc, d) => logLine(`CRASH renderer: ${d.reason} (exit ${d.exitCode})`));
app.on("child-process-gone", (_e, d) => logLine(`CRASH child ${d.type}${d.name ? " " + d.name : ""}: ${d.reason} (exit ${d.exitCode})`));

let lastTakeLog = "";
appOn("diag:takeLog", (_e, text) => {
  lastTakeLog = String(text || "").slice(-4000);
});
appOn("diag:report", () => void reportProblem());
appOn("about:open", (_e, view) => void about().open(view === "report" ? "report" : "about"));

function tailOf(file, maxChars) {
  try {
    const s = fs.readFileSync(file, "utf8");
    return s.length > maxChars ? s.slice(-maxChars) : s;
  } catch {
    return "(no log)";
  }
}

/** The report's sections (about.js titles them): system, the last take's log, the end of startup.log, all masked. */
async function reportSections() {
  let gpu = "";
  try {
    const g = await app.getGPUInfo("basic");
    gpu = [...new Set((g.gpuDevice || []).map((d) => d.deviceString || `${d.vendorId}:${d.deviceId}`).filter(Boolean))].join(", ");
  } catch {
    /* no gpu info */
  }
  const system = [
    `Filow ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${os.release()} ${process.arch}`,
    `${os.cpus()[0] ? os.cpus()[0].model : "cpu?"} · ${Math.round(os.totalmem() / 1024 ** 3)} GB RAM · GPU ${gpu || "?"}`,
    `settings: theme ${settings.theme || "system"}, lang ${menuLang()}, local AI ${settings.localAi ? "on" : "off"}, offline ${offline ? "on" : "off"}`,
  ].join("\n");
  // The user may send the file anywhere: mask live links, keys, addresses and the user's name first.
  let user = "";
  try { user = os.userInfo().username; } catch { /* no user info */ }
  const clean = (text) => diag.redact(text, { home: os.homedir(), user });
  // Dictation and keys (dictation-diag.js): the hook, the settings, this system and the last dictations
  // stage by stage. Names of programs and window classes, counts and times; never the dictated words.
  let dictationFacts;
  try {
    const ok = okFilow ? okFilow.status() : null;
    let mic = "unknown";
    try { mic = process.platform === "linux" ? "the system decides (no permission to ask for)" : `access ${systemPreferences.getMediaAccessStatus("microphone")}`; } catch { /* stays unknown */ }
    dictationFacts = getDictation().reportText({
      hook: { ready: Boolean(ok && ok.hook === "hold"), error: ok ? ok.hookError : "OK Filow did not start", failures: ok ? ok.hookFailures : 0, lastTryAt: ok ? ok.hookLastTryAt : 0, permission: ok ? ok.hookPermission : "" },
      mic,
    });
  } catch (err) {
    dictationFacts = `(not readable: ${err && err.message ? err.message : err})`;
  }
  return [
    { id: "system", text: system },
    // keep: short and the first thing an agent needs, so the issue link never cuts it
    { id: "dictation", text: clean(dictationFacts), keep: true },
    { id: "take", text: clean(lastTakeLog) },
    { id: "log", text: clean(tailOf(path.join(userData, "startup.log"), 6000)) },
  ];
}

let aboutPages = null;
/** About and privacy, Report a problem (about.js): one local window, created on first use. */
function about() {
  aboutPages ||= require("./about").createAboutPages({
    BrowserWindow, ipcMain, dialog, clipboard, shell, openExternalSafe, logLine, fs, path,
    pageFile: path.join(__dirname, "about.html"), preload: path.join(__dirname, "about-preload.js"),
    lang: menuLang, theme: uiTheme, icon: appIcon,
    info: () => ({ version: app.getVersion(), electron: process.versions.electron, configFolder: userData }),
    docsDir: packaged ? resources : path.join(resources, "..", "docs"),
    crashDir: path.join(userData, "Crashpad"), documentsDir: () => app.getPath("documents"),
    collectReport: reportSections,
    // QA builds only: the probe points the issue button at its own local page instead of GitHub
    issuePage: process.env.FILOW_QA_ISSUE_PAGE && require("./qa.js").isQaBuild(app) ? process.env.FILOW_QA_ISSUE_PAGE : undefined,
  });
  return aboutPages;
}

function reportProblem() {
  return about().open("report");
}
/** The two buttons of an error the user cannot fix from its dialog: close it, or open Report a problem. */
function reportButtons() {
  const tx = require("./about").TEXT;
  return [(tx[menuLang()] || tx.en).close, mt("report")];
}
/** Such an error: what failed, the reason, and a button that leads to the report window (and from there to a GitHub issue). */
async function errorWithReport(win, message, detail) {
  const options = { type: "error", title: "Filow", message, detail, buttons: reportButtons(), defaultId: 0, cancelId: 0, noLink: true };
  try {
    const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (response === 1) reportProblem();
  } catch (err) {
    logLine(`error dialog "${message}" could not be shown: ${err && err.message ? err.message : err}`);
  }
}

function buildMenu(win) {
  const template = [
    {
      label: "Filow",
      submenu: [
        { label: sharedText("menu.welcome", menuLang()), click: () => void showWelcome() },
        { label: mt("configFolder"), click: () => shell.openPath(userData) },
        { label: mt("editEnv"), click: () => shell.openPath(envFile) },
        { label: mt("settings"), click: () => win.loadURL(APP_URL + "/settings/local") },
        { label: mt("offline"), type: "checkbox", checked: offline, click: (item) => applyOffline(win, item.checked) },
        { type: "separator" },
        {
          label: tunnels.web ? mt("shareOn", { url: tunnels.web.replace("https://", "") }) : mt("share"),
          type: "checkbox",
          checked: Boolean(settings.remoteShare),
          click: (item) => void setRemoteShare(win, item.checked),
        },
        {
          label: mt("mirrorAddress"),
          submenu: [
            { label: mt("automatic", { ip: lanIp() }), type: "radio", checked: !settings.mirrorHost, click: () => applyMirrorHost(win, "") },
            ...rankedInterfaces().map((i) => ({ label: `${i.address}  (${i.name})${i.score < 0 ? mt("virtualIface") : ""}`, type: "radio", checked: settings.mirrorHost === i.address, click: () => applyMirrorHost(win, i.address) })),
            { type: "separator" },
            { label: mt("customHost"), enabled: false },
          ],
        },
        ...(process.platform === "win32" ? [{ label: mt("firewall"), click: () => void allowFirewall().then(() => rebuildMenu(win)) }] : []),
        settings.pptInstalled
          ? { label: mt("pptRemove"), click: () => void uninstallPowerPointAddin(win) }
          : { label: mt("pptInstall"), click: () => void installPowerPointAddin(win) },
        { label: mt("pptManifest"), click: () => void savePowerPointManifest(win) },
        { type: "separator" },
        {
          label: mt("overlayShow"),
          type: "checkbox",
          checked: Boolean(overlayWin && !overlayWin.isDestroyed()),
          click: (item) => (item.checked ? showOverlay() : hideOverlay()),
        },
        {
          label: mt(process.platform === "win32" ? "pointsWindow" : "pointsWindowPlain"), // only Windows reliably leaves it out of sharing (points-window.js)
          type: "checkbox",
          checked: pointsWindow.isOpen(),
          click: (item) => pointsWindow.set(item.checked),
        },
        {
          label: mt("overlayAuto"),
          type: "checkbox",
          checked: settings.overlayAuto !== false,
          click: (item) => {
            settings.overlayAuto = item.checked;
            saveSettings();
          },
        },
        {
          label: mt("overlayHidden"),
          type: "checkbox",
          checked: Boolean(settings.overlayHidden),
          click: (item) => {
            settings.overlayHidden = item.checked;
            saveSettings();
            if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setContentProtection(item.checked);
          },
        },
        {
          label: mt("hideWindow"),
          type: "checkbox",
          checked: settings.contentProtection,
          click: (item) => {
            settings.contentProtection = item.checked;
            saveSettings();
            win.setContentProtection(item.checked);
          },
        },
        { type: "separator" },
        updateState.status === "downloaded"
          ? { label: mt("updateInstall", { version: updateState.version }), click: () => loadUpdater() && updater.quitAndInstall() }
          : updateState.status === "downloading"
            ? { label: mt("updateDownloading", { version: updateState.version }), enabled: false }
            : updateState.status === "checking"
              ? { label: mt("updateChecking"), enabled: false }
              : { label: mt("updateCheck"), click: () => void checkForUpdates({ manual: true }) },
        { label: mt("about"), click: () => void about().open("about") },
        { label: mt("report"), click: () => void reportProblem() },
        { type: "separator" },
        // These act on the main window only when it (or no window) has the focus: Cmd+R in the About
        // window must not reload the main window in the middle of a take (macOS menus are app-wide).
        { label: mt("reload"), accelerator: "CmdOrCtrl+R", click: (_i, focused) => { if (!focused || focused === win) win.reload(); } },
        { label: mt("fullscreen"), accelerator: "F11", click: (_i, focused) => { if (!focused || focused === win) win.setFullScreen(!win.isFullScreen()); } },
        { label: mt("devtools"), accelerator: "CmdOrCtrl+Shift+I", click: (_i, focused) => { if (!focused || focused === win) win.webContents.toggleDevTools(); } },
        { type: "separator" },
        { label: mt("quit"), role: "quit" },
      ],
    },
    { role: "editMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// SEC-03: our pages get a Content-Security-Policy (apps/desktop/csp.js). FILOW_CSP_REPORT_ONLY=1 only
// reports violations, for checking a policy change before it is enforced.
function installCsp() {
  const { cspHeaders } = require("./csp.js");
  const ports = [PORT, SESSION_PORT, HTTPS_PORT];
  const reportOnly = process.env.FILOW_CSP_REPORT_ONLY === "1";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // The LAN address can change at runtime (network switch, "use this interface"), so read it per response.
    const lan = process.env.FILOW_LAN_IP || lanIp();
    callback({ responseHeaders: cspHeaders(details, ports, reportOnly, lan ? [lan] : []) });
  });
}

async function main() {
  killStaleTunnels();
  installCsp();
  let choices;
  try {
    seed(scriptFile, "script.md");
    const migrated = migrateLegacyProfile();
    seed(envFile, ".env.example");
    loadEnv(envFile);
    loadSecrets();
    aliasLegacyEnv();
    loadSettings();
    freeLlm().apply(); // FreeLLMAPI: the address and model saved in Settings win over .env
    if (migrated) settings.profileMigrated = true;
    choices = readInstallChoices();
    initializeUiPreferences();
    if (settings.welcomeCompleted !== true) {
      startupTransition = true;
      await showWelcome();
      if (quitting) return;
    }
    // startServers() loads the Next server on this thread and blocks it for over a second; the splash
    // could not be shown until then (PERF-01: 1.3 s to splash). Show it first, waiting at most 1.5 s.
    await Promise.race([showSplash(), new Promise((r) => setTimeout(r, 1500))]);
    startupTransition = false;
    splashStatus(st("servers"));
    stage("loading servers");
    startServers();
  } catch (err) {
    failStartup(err);
    return;
  }

  // Microphone and screen capture for the engine.
  const allowed = (permission) => permission === "media" || permission === "display-capture" || permission === "notifications";
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed(permission));

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: uiTheme() === "dark" ? "#121212" : "#f6f7f9",
    title: "Filow",
    show: false,
    icon: appIcon(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.js") },
  });
  mainWin = win;
  const watchdog = setTimeout(() => {
    if (win.isDestroyed() || win.isVisible()) return;
    logLine(`startup watchdog: still at "${startupStage}" after ${STARTUP_WATCHDOG_MS / 1000} s, showing the window`);
    closeSplash();
    win.show();
  }, STARTUP_WATCHDOG_MS);
  win.once("show", () => clearTimeout(watchdog));
  reloadOnCrash(win, "main");
  endTakeWithPage(win);
  win.on("focus", () => uiPreferences?.refresh());
  win.on("closed", () => { mainWin = null; aboutPages?.close(); }); // About must not keep Filow running alone
  nativeTheme.themeSource = settings.theme === "light" || settings.theme === "dark" ? settings.theme : "system";
  // §6.2: the window is already filtered out of Screen Sense's own chooser; hiding it from every
  // capture is opt-in (menu) because it also blanks the user's own screenshots.
  win.setContentProtection(Boolean(settings.contentProtection));
  applyOffline(win);
  buildMenu(win);
  wireScreenSense();
  startSlideShowWatch();
  appHandle("slideshow:state", () => slideShow);
  appOn("overlay:close", (e) => (pointsWindow.owns(e.sender) ? pointsWindow.hide() : hideOverlay()));
  appOn("session:codeSpent", (e) => {
    // a floating window paired with the code on screen: the page shows a fresh one for the next device
    if (!mainWin || mainWin.isDestroyed() || e.sender === mainWin.webContents) return;
    internalEvents.emit("codeSpent");
    mainWin.webContents.send("session:needCode");
  });
  // A floating window whose code was spent (a crash reload loads the same URL) asks to join again; at
  // most once in 10 s per window, so a session that refuses every code cannot make it spin.
  const rejoinedAt = new Map();
  appOn("overlay:rejoin", (e) => {
    const now = Date.now();
    if (now - (rejoinedAt.get(e.sender.id) || 0) < 10_000) return;
    rejoinedAt.set(e.sender.id, now);
    if (pointsWindow.owns(e.sender)) void pointsWindow.reload();
    else if (overlayWin && !overlayWin.isDestroyed() && e.sender === overlayWin.webContents) void showOverlay();
  });
  appHandle("points:status", () => ({ open: pointsWindow.isOpen() }));
  appHandle("points:set", async (_e, on) => {
    await pointsWindow.set(on === true);
    return { open: pointsWindow.isOpen() };
  });
  startOkFilow();
  win.on("closed", () => okFilow?.dispose());
  const hk = registerHotkey();
  if (!hk.ok) console.warn("Screen Sense hotkey:", hk.error);
  if (settings.profileMigrated) {
    delete settings.profileMigrated;
    saveSettings();
    void refreshPptRegistrationAfterMigration();
  }
  guardNavigation(win);

  // The public link starts now and comes up while the app opens: about 6 s, bound by trycloudflare.com
  // issuing the address. The window does not wait for it and is not reloaded when it arrives: the page
  // gets the new addresses with the "remote:status" event and redraws the pairing QR in place
  // (docs/OWNER-DECISIONS.md D2, third option). Until then the QR carries the address on this network.
  const wantLink = settings.remoteShare && !offline && !process.env.FILOW_SESSION_URL;
  if (wantLink) void setRemoteShare(win, true, { auto: true, reload: false });

  try {
    stage("waiting for servers");
    await waitFor(APP_URL + "/api/stt/status");
    if (!process.env.FILOW_SESSION_URL) await waitFor(`http://127.0.0.1:${SESSION_PORT}/health`);
    stage("servers answering");
    if (!choices && !settings.localAiOffered) choices = await offerLocalAi();
    if (!settings.localAiOffered) {
      settings.localAiOffered = true;
      saveSettings();
    }
    if (!settings.firewallOffered) {
      settings.firewallOffered = true;
      saveSettings();
      await offerFirewall(win);
    }
    if (choices && choices.ollama) void startOllamaInstall();
    else startOllamaIfWanted("Filow opened");
    const firstPage =
      choices && Array.isArray(choices.models) && choices.models.length
        ? `${APP_URL}/settings/local?auto=${encodeURIComponent(choices.models.join(","))}${choices.ollama ? "&ollama=1" : ""}`
        : APP_URL;
    stage("loading first page");
    await win.loadURL(firstPage);
    stage("first page loaded");
    splashStatus(st("ready"), true);
    const wait = Math.max(400, SPLASH_MIN_MS - (Date.now() - splashShownAt));
    setTimeout(() => {
      closeSplash();
      if (!win.isDestroyed()) win.show();
      logLine(`main window shown (${Math.round(performance.now())} ms after process start)`);
    }, wait);
    setTimeout(() => void checkForUpdates(), 8000); // after the servers and the tunnel; silent unless an update lands
    if (process.platform === "win32" || process.platform === "darwin") {
      if (settings.pptInstalled) {
        startHttpsProxy();
        if (!fs.existsSync(pptManifestFile)) writeLocalPptManifest();
      } else if (!settings.pptAsked) {
        settings.pptAsked = true;
        saveSettings();
        const { response } = await dialog.showMessageBox(win, {
          type: "question",
          buttons: [mt("pptYes"), mt("pptNo")],
          defaultId: 0,
          title: "PowerPoint",
          message: mt("pptFirstRun"),
          detail: mt("pptFirstRunDetail"),
        });
        if (response === 0) await installPowerPointAddin(win);
      }
    }
    if (!process.env.OPENROUTER_API_KEY) {
      dialog.showMessageBox(win, {
        type: "info",
        title: mt("keyTitle"),
        message: mt("keyMessage"),
        detail: mt("keyDetail", { file: envFile }),
      });
    }
  } catch (err) {
    failStartup(err);
  }
}

/**
 * A start that cannot go on. The reason goes to startup.log first: the error box blocks the whole
 * process until someone clicks it, so a test run, or a user who closes it, would otherwise have no
 * trace (a package built without the session server bundle sat on the splash for minutes this way).
 */
function failStartup(err) {
  const text = String(err && err.stack ? err.stack : err);
  logLine(`startup failed at "${startupStage}": ${text}`);
  closeSplash();
  // The user cannot fix this one: next to closing, the box offers Report a problem, whose window has the
  // start-up log with this reason in it and the button that opens a GitHub issue. Filow quits when that
  // window closes. If the box or the window cannot be made, the plain error box and quit, as before.
  let report = false;
  try {
    const choice = dialog.showMessageBoxSync({ type: "error", title: "Filow", message: "Filow failed to start", detail: text, buttons: reportButtons(), defaultId: 0, cancelId: 0, noLink: true });
    report = choice === 1;
  } catch (boxErr) {
    logLine(`startup failed: the report offer could not be shown: ${boxErr && boxErr.message ? boxErr.message : boxErr}`);
    dialog.showErrorBox("Filow failed to start", text);
  }
  if (report) {
    try {
      startupTransition = true; // the splash just closed: its window-all-closed must not quit under the report window
      const win = reportProblem();
      win.once("closed", () => app.quit());
      win.webContents.once("did-fail-load", () => app.quit()); // a window that cannot show must not keep Filow running unseen
      return;
    } catch (winErr) {
      logLine(`startup failed: the report window could not be opened: ${winErr && winErr.message ? winErr.message : winErr}`);
    }
  }
  app.quit();
}

app.setAppUserModelId("com.intelliprompter.app");
if (firstInstance) app.whenReady().then(main);
app.on("window-all-closed", () => { if (!startupTransition) app.quit(); });
app.on("before-quit", () => { quitting = true; uiPreferences?.dispose(); okFilow?.dispose(); });
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopTunnels({ wait: true });
  if (httpsProxy) httpsProxy.close();
  if (stopSlideShowWatch) stopSlideShowWatch();
  localAi.stopOwnOllama(); // only an "ollama serve" Filow started itself; Ollama's own app keeps running
});
