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
// Test builds only: FILOW_OKF_FAKE_MIC=<wav> feeds that file to every microphone, so OK Filow's voice
// paths can be checked end to end without a person talking.
// QA builds only (apps/desktop/qa.js): never unlocked by a file next to the exe.
if (process.env.FILOW_OKF_FAKE_MIC && require("./qa.js").isQaBuild(app)) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-file-for-fake-audio-capture", process.env.FILOW_OKF_FAKE_MIC);
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
// Native crash dumps (main, renderer, GPU, utility) stay on this PC under userData/Crashpad; nothing
// is uploaded. A report leaves the PC only through "Send report", which the user starts.
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

// Menu strings. The page owns the choice (Settings / EN-IT switch) and tells us over IPC; "" = system locale.
const MENU_TEXT = {
  en: {
    configFolder: "Open config folder (keys + script)", editEnv: "Edit API keys (.env)", settings: "Local models & privacy settings",
    offline: "Offline mode (local models only, no outbound requests)", share: "Share to phone on any network (Cloudflare tunnel)",
    shareOn: "Share to phone on any network (on: {url})", mirrorAddress: "Mirror address on this network", automatic: "Automatic ({ip})",
    customHost: "Custom host: set FILOW_MIRROR_HOST in .env", virtualIface: "  · virtual, not for phones", firewall: "Allow Filow in Windows Firewall (phone on the Wi-Fi)…", hideWindow: "Hide this window from screen recordings and screenshots",
    reload: "Reload", fullscreen: "Toggle fullscreen", devtools: "Developer tools", quit: "Quit",
    pptInstall: "Add Filow to PowerPoint on this PC",
    pptInstalled: "Done. Restart PowerPoint: Filow is on the Home tab (Add-ins group; on a Mac under Insert → My Add-ins). It talks to the app running on this PC, so keep Filow open while you present.",
    pptInstallFailed: "Could not add the add-in to PowerPoint.",
    pptRemove: "Remove Filow from PowerPoint on this PC",
    pptRemoved: "Removed. Restart PowerPoint.",
    pptWinOnly: "Automatic install works on Windows and macOS. On Linux there is no PowerPoint; save the manifest for another computer instead.",
    pptFirstRun: "Add Filow to PowerPoint?",
    pptFirstRunDetail: "A certificate for localhost is created and trusted for your user (the system asks once), and the add-in is registered for PowerPoint on this computer. You can undo it from the menu. On a Mac the pane runs in View mode (no microphone in Office for Mac): start the take here or on the phone.",
    pptYes: "Add to PowerPoint",
    pptNo: "Not now",
    pptManifest: "PowerPoint add-in: save manifest for another computer…",
    overlayShow: "Presenter overlay (points on top of the slide show)",
    okfOpen: "Open OK Filow",
    okfShowAlways: "Always show the buddy",
    okfEnabled: "OK Filow on",
    okfNoCapture: "Could not take a screenshot of the screens.",
    okfNoStt: "Downloading speech-to-text for this PC (about 450 MB). Type your question meanwhile, or try again in a few minutes.",
    overlayAuto: "Open the overlay automatically when a slide show starts",
    overlayHidden: "Hide the overlay from screen recordings and shares",
    updateCheck: "Check for updates…",
    report: "Report a problem…",
    updateChecking: "Checking for updates…",
    updateDownloading: "Downloading update {version}…",
    updateInstall: "Restart to install {version}",
    updateReady: "Filow {version} is ready.",
    updateReadyDetail: "Restart now to install it, or it installs itself the next time you quit.",
    updateRestart: "Restart now",
    updateLater: "Later",
    updateNone: "You have the latest version ({version}).",
    updateFailed: "Could not check for updates.",
    updateOffline: "Offline mode is on; updates need an internet connection.",
    pptNoOrigin: "PowerPoint only loads add-ins over HTTPS. Turn on “Share to phone on any network” first (the manifest will point at that public URL), or set PUBLIC_ORIGIN=https://your-server in .env for a permanent install.",
    pptSaved: "Manifest saved. Sideload it:\n\n• PowerPoint for the web: Home → Add-ins → More Add-ins → My Add-ins → Upload My Add-in → this file.\n• PowerPoint for Windows: put the file in a shared folder, add that folder under File → Options → Trust Center → Trusted Add-in Catalogs, restart PowerPoint, then Insert → My Add-ins → Shared Folder.\n\nThe pane is served from {origin}. A tunnel URL changes every time sharing restarts; save a new manifest then.",
  },
  it: {
    configFolder: "Apri la cartella di configurazione (chiavi + copione)", editEnv: "Modifica le chiavi API (.env)", settings: "Modelli locali e privacy",
    offline: "Modalità offline (solo modelli locali, nessuna richiesta in uscita)", share: "Condividi col telefono su qualsiasi rete (tunnel Cloudflare)",
    shareOn: "Condividi col telefono su qualsiasi rete (attivo: {url})", mirrorAddress: "Indirizzo del mirror su questa rete", automatic: "Automatico ({ip})",
    customHost: "Host personalizzato: imposta FILOW_MIRROR_HOST in .env", virtualIface: "  · virtuale, non per i telefoni", firewall: "Consenti Filow nel firewall di Windows (telefono sul Wi-Fi)…", hideWindow: "Nascondi questa finestra da registrazioni e screenshot",
    reload: "Ricarica", fullscreen: "Schermo intero", devtools: "Strumenti per sviluppatori", quit: "Esci",
    pptInstall: "Aggiungi Filow a PowerPoint su questo PC",
    pptInstalled: "Fatto. Riavvia PowerPoint: Filow è nella scheda Home (gruppo Componenti aggiuntivi; su Mac in Inserisci → I miei componenti). Parla con l'app in esecuzione su questo PC, quindi tieni aperto Filow mentre presenti.",
    pptInstallFailed: "Impossibile aggiungere il componente a PowerPoint.",
    pptRemove: "Rimuovi Filow da PowerPoint su questo PC",
    pptRemoved: "Rimosso. Riavvia PowerPoint.",
    pptWinOnly: "L'installazione automatica funziona su Windows e macOS. Su Linux non c'è PowerPoint; salva il manifest per un altro computer.",
    pptFirstRun: "Aggiungere Filow a PowerPoint?",
    pptFirstRunDetail: "Viene creato un certificato per localhost, considerato attendibile per il tuo utente (il sistema chiede una volta), e il componente viene registrato per PowerPoint su questo computer. Puoi annullare dal menu. Su Mac il pannello funziona in modalità Vista (niente microfono in Office per Mac): avvia la registrazione qui o dal telefono.",
    pptYes: "Aggiungi a PowerPoint",
    pptNo: "Non ora",
    pptManifest: "Componente aggiuntivo PowerPoint: salva il manifest per un altro computer…",
    overlayShow: "Overlay relatore (punti sopra la presentazione)",
    okfOpen: "Apri OK Filow",
    okfShowAlways: "Mostra sempre l'assistente",
    okfEnabled: "OK Filow attivo",
    okfNoCapture: "Non sono riuscito a fare lo screenshot degli schermi.",
    okfNoStt: "Sto scaricando il riconoscimento vocale per questo PC (circa 450 MB). Intanto scrivi la domanda, o riprova tra qualche minuto.",
    overlayAuto: "Apri l'overlay da solo quando parte una presentazione",
    overlayHidden: "Nascondi l'overlay da registrazioni e condivisioni dello schermo",
    updateCheck: "Controlla aggiornamenti…",
    report: "Segnala un problema…",
    updateChecking: "Controllo aggiornamenti…",
    updateDownloading: "Scaricamento aggiornamento {version}…",
    updateInstall: "Riavvia per installare {version}",
    updateReady: "Filow {version} è pronto.",
    updateReadyDetail: "Riavvia ora per installarlo, oppure si installa da solo alla prossima chiusura.",
    updateRestart: "Riavvia ora",
    updateLater: "Più tardi",
    updateNone: "Hai già l'ultima versione ({version}).",
    updateFailed: "Impossibile controllare gli aggiornamenti.",
    updateOffline: "La modalità offline è attiva; gli aggiornamenti richiedono internet.",
    pptNoOrigin: "PowerPoint carica i componenti aggiuntivi solo via HTTPS. Attiva prima “Condividi col telefono su qualsiasi rete” (il manifest punterà a quell'URL pubblico), oppure imposta PUBLIC_ORIGIN=https://tuo-server in .env per un'installazione permanente.",
    pptSaved: "Manifest salvato. Caricalo in PowerPoint:\n\n• PowerPoint per il web: Home → Componenti aggiuntivi → Altri componenti → I miei componenti → Carica il mio componente → questo file.\n• PowerPoint per Windows: metti il file in una cartella condivisa, aggiungi la cartella in File → Opzioni → Centro protezione → Cataloghi di componenti aggiuntivi attendibili, riavvia PowerPoint, poi Inserisci → I miei componenti → Cartella condivisa.\n\nIl pannello è servito da {origin}. Un URL del tunnel cambia a ogni riavvio della condivisione: salva allora un nuovo manifest.",
  },
};
function menuLang() {
  if (settings.lang === "it" || settings.lang === "en") return settings.lang;
  return app.getLocale().toLowerCase().startsWith("it") ? "it" : "en";
}
function mt(key, vars) {
  const text = MENU_TEXT[menuLang()][key] || MENU_TEXT.en[key] || key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
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
const { t: sharedText } = require("./vendor/i18n");
const { createUiPreferences, trustedUiSender, createWelcomeController } = require("./ui-preferences");
const { pathToFileURL } = require("node:url");
const welcomeFile = path.join(__dirname, "welcome.html");
const welcomeUrl = pathToFileURL(welcomeFile).href;
let uiPreferences, welcomeController, welcomeWin = null;
let startupTransition = false, quitting = false;
let welcomeHydrationTimer;

function uiSender(event, welcomeOnly = false) {
  return trustedUiSender(event, {
    welcome: welcomeWin?.webContents,
    pages: [mainWin?.webContents, overlayWin?.webContents].filter(Boolean),
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
    for (const win of [mainWin, overlayWin, welcomeWin]) {
      if (!win || win.isDestroyed()) continue;
      const wc = win.webContents;
      if (uiSender({ sender: wc, senderFrame: wc.mainFrame })) wc.send("ui:preferencesChanged", state);
    }
    if (mainWin && !mainWin.isDestroyed()) buildMenu(mainWin);
  });
  // OK Filow's section in Filow Settings: the main window reads and writes the same settings the panel does.
  ipcMain.handle("okfilow:settings:status", event => { if (!uiSender(event)) throw new Error("Denied"); return okFilow ? okFilow.status() : null; });
  ipcMain.handle("okfilow:settings:configure", (event, patch) => { if (!uiSender(event)) throw new Error("Denied"); return okFilow && patch && typeof patch === "object" ? okFilow.applyConfig(patch) : null; });
  ipcMain.on("okfilow:settings:openPanel", event => { if (uiSender(event)) okFilow?.togglePanel(); });
  ipcMain.handle("ui:getPreferences", event => { if (!uiSender(event)) throw new Error("Denied"); return uiPreferences.get(); });
  ipcMain.handle("ui:updatePreferences", (event, patch) => { if (!uiSender(event)) throw new Error("Denied"); return uiPreferences.update(patch); });
  ipcMain.handle("ui:migratePreferences", (event, patch) => { if (!uiSender(event) || event.sender === welcomeWin?.webContents) throw new Error("Denied"); return uiPreferences.migrateLegacy(patch); });
  for (const key of ["lang", "theme"]) ipcMain.on(`ui:${key}`, (event, value) => {
    if (uiSender(event)) void uiPreferences.update({ [key]: value });
  });
  ipcMain.handle("welcome:complete", event => { if (!uiSender(event, true)) throw new Error("Denied"); return welcomeController.finish(); });
  ipcMain.on("welcome:ready", event => {
    if (!uiSender(event, true) || quitting) return;
    clearTimeout(welcomeHydrationTimer);
    welcomeWin.show();
  });
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
    pickerWin.loadFile(path.join(__dirname, "picker.html"), { query: { lang: menuLang() } }).then(() => {
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
  appHandle("remote:status", () => ({ state: tunnels.state, url: tunnels.web, error: tunnels.error, wanted: Boolean(settings.remoteShare) }));
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
  appOn("session:report", (_e, info) => {
    if (info && typeof info.code === "string" && typeof info.id === "string") {
      const changedSession = !currentSession || currentSession.id !== info.id;
      currentSession = { id: info.id, code: info.code };
      if (changedSession && overlayWin && !overlayWin.isDestroyed()) overlayWin.loadURL(overlayUrl());
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
const NET_TEXT = {
  en: { title: "Let your phone reach Filow on this network?", message: "Phones on the same Wi-Fi can only open the mirror if Windows Firewall lets Filow accept connections.", detail: "Filow adds one rule for its own program (incoming, all profiles). Windows will ask for administrator confirmation.", allow: "Allow", later: "Not now" },
  it: { title: "Permettere al telefono di raggiungere Filow su questa rete?", message: "I telefoni sullo stesso Wi-Fi possono aprire il mirror solo se Windows Firewall lascia che Filow accetti connessioni.", detail: "Filow aggiunge una regola per il proprio programma (in entrata, tutti i profili). Windows chiederà la conferma dell'amministratore.", allow: "Consenti", later: "Non ora" },
};
function rebuildMenu(win) {
  try {
    buildMenu(win);
  } catch {
    /* menu rebuild is cosmetic */
  }
}
async function offerFirewall(win) {
  if (process.platform !== "win32" || firewallStatus() === "ok") return;
  const tx = NET_TEXT[menuLang()] || NET_TEXT.en;
  const { response } = await dialog.showMessageBox(win, { type: "question", title: tx.title, message: tx.message, detail: tx.detail, buttons: [tx.allow, tx.later], defaultId: 0, cancelId: 1, noLink: true });
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
  internalEvents.emit("remote:status", null, { state, url: tunnels.web, error });
  if (state === "downloading") splashStatus(st("download"));
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("remote:status", { state, url: tunnels.web, error });
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

function download(url, dest, hops = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Filow" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops > 0) {
          res.resume();
          return download(res.headers.location, dest, hops - 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) return reject(new Error(`download failed: HTTP ${res.statusCode}`));
        const out = fs.createWriteStream(dest);
        const fail = (e) => { out.destroy(); fs.rm(dest, { force: true }, () => reject(e)); };
        res.on("error", fail);
        res.on("aborted", () => fail(new Error("download aborted")));
        out.on("error", fail);
        res.pipe(out);
        out.on("finish", () => out.close(resolve));
      })
      .on("error", reject);
  });
}

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
      buttons: ["Download", "Cancel"],
      defaultId: 0,
      title: "Share to a phone on another network",
      message: "This needs Cloudflare's free cloudflared tool (about 20 MB).",
      detail: `It will be downloaded once from\n${base}${asset}\ninto\n${path.join(userData, "bin")}\n\nWhile sharing is on, the mirror page and the session relay are reachable through random *.trycloudflare.com URLs. Pairing still needs the 6-digit code.`,
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
function killTree(pid) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(pid);
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

function stopTunnels() {
  for (const p of tunnels.procs) {
    if (!p.pid || !killTree(p.pid)) {
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
        if (offline) throw new Error("Offline mode is on; the public link needs outbound connections.");
        if (process.env.FILOW_SESSION_URL) throw new Error("A hosted session server is configured in .env; its URL is already public.");
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
        remoteStatus("connecting");
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
          dialog.showErrorBox("Could not share to another network", String(err.message || err));
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
    if (!silent) dialog.showErrorBox("PowerPoint", `${mt("pptInstallFailed")}\n\n${String(err.message || err)}`);
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
    if (manual) dialog.showMessageBox(mainWin, { type: "info", title: "Filow", message: "Updates only work in the installed app." });
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
    backgroundColor: uiTheme() === "dark" ? "#08090b" : "#f7f7f5", title: "Filow",
    icon: appIcon(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const q = new URLSearchParams({ v: app.getVersion(), theme: uiTheme(), local: local ? "1" : "0", lang: menuLang() });
  splashShownAt = Date.now();
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
const SPLASH_TEXT = {
  en: { servers: "Starting the local servers…", link: "Preparing the public link for your phone…", download: "Downloading the link tool (one time)…", ready: "Ready" },
  it: { servers: "Avvio dei server locali…", link: "Preparazione del link pubblico per il telefono…", download: "Download dello strumento per il link (una tantum)…", ready: "Pronto" },
};
const st = (key) => (SPLASH_TEXT[menuLang()] || SPLASH_TEXT.en)[key];

/** install-choices.json is written by the Windows installer (build/installer.nsh): language and models to fetch. */
function readInstallChoices() {
  const file = path.join(userData, "install-choices.json");
  try {
    if (!fs.existsSync(file)) return null;
    const choices = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.rmSync(file, { force: true });
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
      sttLocal,
      userData,
      menuText: (k) => mt(k),
      isOffline: () => offline,
      sttDownload: () => void sttDownload(),
    });
    okFilow.start();
  } catch (err) {
    okFilow = null;
    logLine(`okfilow failed to start: ${err && err.stack ? err.stack : err}`);
  }
}

// ---- Streaming speech-to-text on this PC (stt.js + stt-worker.js) ----
const sttLocal = require("./stt");
let sttSession = null;
let sttModelState = { state: "idle", pct: 0, error: "" };
function sttStatus() {
  const ready = sttLocal.modelReady(userData);
  const model = ready ? "ready" : sttModelState.state === "downloading" || sttModelState.state === "extracting" || sttModelState.state === "error" ? sttModelState.state : "missing";
  return { model, pct: sttModelState.pct, error: sttModelState.error || undefined, running: Boolean(sttSession && sttSession.ready), partial: ready ? 0 : sttLocal.partialPct(userData) };
}
function sttBroadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}
let sttDownloading = null;
function sttDownload() {
  if (process.env.FILOW_OFFLINE === "1") {
    sttModelState = { state: "error", pct: 0, error: sharedText("offline.downloadDisabled", menuLang()) };
    sttBroadcast("stt:status", sttStatus());
    return Promise.resolve();
  }
  if (sttDownloading) return sttDownloading;
  sttDownloading = sttLocal
    .ensureModel(userData, (s) => {
      sttModelState = { state: s.state, pct: s.pct, error: s.error || "" };
      logLine(`stt model: ${s.state}${s.pct ? ` ${s.pct}%` : ""}${s.message ? ` ${s.message}` : ""}${s.error ? ` ${s.error}` : ""}`);
      sttBroadcast("stt:status", sttStatus());
    })
    .finally(() => {
      sttDownloading = null;
    });
  return sttDownloading;
}
function wireStt() {
  appHandle("stt:status", () => sttStatus());
  appOn("stt:download", () => void sttDownload());
  appHandle("stt:remove", () => {
    if (sttSession) sttSession.dispose();
    sttSession = null;
    sttLocal.removeModel(userData);
    sttBroadcast("stt:status", sttStatus());
  });
  appHandle("stt:start", async (e, language) => {
    if (!sttSession) sttSession = new sttLocal.SttSession(userData, logLine);
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
function localAiInfo() {
  if (!localAiHardware) {
    const hw = localAi.hardwareScan();
    localAiHardware = { ...hw, recommended: localAi.recommend(hw) };
  }
  return localAiHardware;
}
function setLocalAi(s) {
  localAiState = s;
  logLine(`local AI: ${s.state}${s.pct ? ` ${s.pct}%` : ""}${s.error ? ` ${s.error}` : ""}`);
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("localai:status", s);
}
function startOllamaInstall() {
  if (process.env.FILOW_OFFLINE === "1") {
    setLocalAi({ ...localAiState, state: "error", pct: 0, error: sharedText("offline.downloadDisabled", menuLang()) });
    return Promise.resolve();
  }
  if (localAiInstalling) return localAiInstalling;
  localAiInstalling = localAi.installOllama(path.join(userData, "bin"), setLocalAi).finally(() => {
    localAiInstalling = null;
  });
  return localAiInstalling;
}
const LOCAL_AI_TEXT = {
  en: {
    title: "Run AI on this computer?",
    install: "Install now",
    later: "Not now",
    message: (hw, rec) => `Filow can transcribe and decide on this ${hw.platform === "darwin" ? "Mac" : "PC"} without any cloud. Install the recommended local models now (about ${rec.downloadGb} GB)?`,
    detail: (hw, rec) => `This computer: ${hw.ramGb} GB RAM${hw.gpu ? ` · ${hw.gpu}` : ""}${hw.freeGb >= 0 ? ` · ${hw.freeGb} GB free` : ""}\n\nRecommended: ${rec.labels.join(", ")}${rec.ollama ? "\nOllama (the local model runner) is installed in the background." : ""}\n\nDownloads run while you use the app; you can change everything later in Settings.`,
  },
  it: {
    title: "Eseguire l'AI su questo computer?",
    install: "Installa ora",
    later: "Non ora",
    message: (hw, rec) => `Filow può trascrivere e decidere su questo ${hw.platform === "darwin" ? "Mac" : "PC"} senza alcun cloud. Installare ora i modelli locali consigliati (circa ${rec.downloadGb} GB)?`,
    detail: (hw, rec) => `Questo computer: ${hw.ramGb} GB di RAM${hw.gpu ? ` · ${hw.gpu}` : ""}${hw.freeGb >= 0 ? ` · ${hw.freeGb} GB liberi` : ""}\n\nConsigliati: ${rec.labels.join(", ")}${rec.ollama ? "\nOllama (il motore dei modelli locali) viene installato in background." : ""}\n\nI download proseguono mentre usi l'app; puoi cambiare tutto in Impostazioni.`,
  },
};
/** First start without installer choices (macOS, Linux, portable): offer the hardware-based setup. */
async function offerLocalAi() {
  const info = localAiInfo();
  const rec = info.recommended;
  if (!rec.models.length) return null;
  const tx = LOCAL_AI_TEXT[menuLang()] || LOCAL_AI_TEXT.en;
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: tx.title,
    message: tx.message(info, rec),
    detail: tx.detail(info, rec),
    buttons: [tx.install, tx.later],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return response === 0 ? { models: rec.models, ollama: rec.ollama } : null;
}

let overlayWin = null;
let stopSlideShowWatch = null;
let slideShow = { running: false, index: -1, total: 0, title: "" };

function overlayUrl() {
  // The overlay is a compact phone-mirror view of the app's own session: nothing to pair, auto-accepted as a local peer.
  const code = currentSession ? currentSession.code : "";
  return `${APP_URL}/mirror?compact=1&overlay=1${code ? `&code=${code}` : ""}`;
}

function showOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.show();
    overlayWin.loadURL(overlayUrl());
    return;
  }
  const b = settings.overlayBounds || {};
  overlayWin = new BrowserWindow({
    width: b.width || 440,
    height: b.height || 360,
    x: b.x,
    y: b.y,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    minimizable: false,
    skipTaskbar: true,
    hasShadow: true,
    opacity: settings.overlayOpacity || 0.94,
    backgroundColor: uiTheme() === "dark" ? "#08090b" : "#f7f7f5",
    title: "Filow overlay",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.js") },
  });
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  reloadOnCrash(overlayWin, "overlay");
  overlayWin.on("focus", () => uiPreferences?.refresh());
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setContentProtection(Boolean(settings.overlayHidden));
  overlayWin.loadURL(overlayUrl());
  const remember = () => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    settings.overlayBounds = overlayWin.getBounds();
    saveSettings();
  };
  overlayWin.on("moved", remember);
  overlayWin.on("resized", remember);
  overlayWin.on("closed", () => (overlayWin = null));
  buildMenu(mainWin);
}

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
  require(webServer); // Next's standalone server starts listening when required
  if (!hosted) require(sessionServer); // relay in-process; hosted mode uses the remote one
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

// ---- Diagnostics: crashes go to startup.log; "Report a problem" opens a prefilled GitHub issue ----
const diag = require("./diag");
// Nothing is sent by itself. The issue page opens in the browser with the text below; the user reads
// it and submits (public repo stefandsl/filow-releases, so the owner sees every report on GitHub).
process.on("uncaughtException", (err) => logLine(`CRASH main: ${err && err.stack ? err.stack : err}`));
process.on("unhandledRejection", (err) => logLine(`CRASH main (promise): ${err && err.stack ? err.stack : err}`));
app.on("render-process-gone", (_e, _wc, d) => logLine(`CRASH renderer: ${d.reason} (exit ${d.exitCode})`));
app.on("child-process-gone", (_e, d) => logLine(`CRASH child ${d.type}${d.name ? " " + d.name : ""}: ${d.reason} (exit ${d.exitCode})`));

let lastTakeLog = "";
appOn("diag:takeLog", (_e, text) => {
  lastTakeLog = String(text || "").slice(-4000);
});
appOn("diag:report", () => void reportProblem(mainWin));

function tailOf(file, maxChars) {
  try {
    const s = fs.readFileSync(file, "utf8");
    return s.length > maxChars ? s.slice(-maxChars) : s;
  } catch {
    return "(no log)";
  }
}

async function reportProblem(win) {
  let gpu = "";
  try {
    const g = await app.getGPUInfo("basic");
    gpu = (g.gpuDevice || []).map((d) => d.deviceString || `${d.vendorId}:${d.deviceId}`).filter(Boolean).join(", ");
  } catch {
    /* no gpu info */
  }
  const head = [
    `Filow ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${os.release()} ${process.arch}`,
    `${os.cpus()[0] ? os.cpus()[0].model : "cpu?"} · ${Math.round(os.totalmem() / 1024 ** 3)} GB RAM · GPU ${gpu || "?"}`,
    `settings: theme ${settings.theme || "system"}, lang ${menuLang()}, local AI ${settings.localAi ? "on" : "off"}`,
  ].join("\n");
  // The issue is public: mask live links, keys, addresses and the user's name before it leaves the app.
  let user = "";
  try { user = os.userInfo().username; } catch { /* no user info */ }
  const clean = (text) => diag.redact(text, { home: os.homedir(), user });
  const sections = {
    head: [
      "**What happened**", "", "(describe here)", "",
      "**System**", "```", head, "```",
      "**Take log**", "```", clean(lastTakeLog || "(no take yet)"), "```",
      "**startup.log (tail)**", "```", "",
    ].join("\n"),
    log: clean(tailOf(path.join(userData, "startup.log"), 6000)),
    tail: "\n```",
  };
  const body = sections.head + sections.log + sections.tail;
  const title = `[${app.getVersion()}] problem on ${process.platform}`;
  if (process.env.FILOW_OFFLINE === "1") {
    const { response } = await dialog.showMessageBox({
      type: "info", title: "Filow", message: sharedText("offline.reportCopyPrompt", menuLang()),
      buttons: [sharedText("offline.copyReport", menuLang()), sharedText("common.cancel", menuLang())],
      defaultId: 0, cancelId: 1,
    });
    if (response === 0) clipboard.writeText(body);
    return;
  }
  // Browsers and GitHub cut long URLs: the oldest log lines go first, and the full text goes to the clipboard.
  const { url, truncated } = diag.issueUrl("https://github.com/stefandsl/filow-releases/issues/new", title, sections, 7800);
  logLine(`report: opening issue form (${body.length} chars${truncated ? ", log shortened" : ""})`);
  await openExternalSafe(url);
  if (truncated && win && !win.isDestroyed()) {
    // The browser cuts long URLs: the full text goes to the clipboard so the user can paste it.
    clipboard.writeText(body);
    void dialog.showMessageBox(win, { type: "info", message: menuLang() === "it" ? "Il testo completo del report è negli appunti: incollalo nella segnalazione." : "The full report text is on the clipboard: paste it into the issue." });
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
        { label: mt("report"), click: () => void reportProblem(win) },
        { type: "separator" },
        { label: mt("reload"), accelerator: "CmdOrCtrl+R", click: () => win.reload() },
        { label: mt("fullscreen"), accelerator: "F11", click: () => win.setFullScreen(!win.isFullScreen()) },
        { label: mt("devtools"), accelerator: "CmdOrCtrl+Shift+I", click: () => win.webContents.toggleDevTools() },
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
  let choices = null;
  try {
    seed(scriptFile, "script.md");
    const migrated = migrateLegacyProfile();
    seed(envFile, ".env.example");
    loadEnv(envFile);
    loadSecrets();
    aliasLegacyEnv();
    loadSettings();
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
    closeSplash();
    dialog.showErrorBox("Filow failed to start", String(err && err.stack ? err.stack : err));
    app.quit();
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
  win.on("focus", () => uiPreferences?.refresh());
  win.on("closed", () => { mainWin = null; });
  nativeTheme.themeSource = settings.theme === "light" || settings.theme === "dark" ? settings.theme : "system";
  // §6.2: the window is already filtered out of Screen Sense's own chooser; hiding it from every
  // capture is opt-in (menu) because it also blanks the user's own screenshots.
  win.setContentProtection(Boolean(settings.contentProtection));
  applyOffline(win);
  buildMenu(win);
  wireScreenSense();
  startSlideShowWatch();
  appHandle("slideshow:state", () => slideShow);
  appOn("overlay:close", () => hideOverlay());
  startOkFilow();
  win.on("closed", () => okFilow?.dispose());
  const hk = registerHotkey();
  if (!hk.ok) console.warn("Screen Sense hotkey:", hk.error);
  if (settings.profileMigrated) {
    delete settings.profileMigrated;
    saveSettings();
    void refreshPptRegistrationAfterMigration();
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });

  // The public link only needs the two ports, not a loaded page: start it now so it comes up while the
  // servers warm up. If it is ready before the first page loads, that page already has the public
  // URLs and no reload is needed; if it comes up later, the page reloads once (as before).
  const wantLink = settings.remoteShare && !offline && !process.env.FILOW_SESSION_URL;
  const linkUp = !wantLink
    ? null
    : new Promise((resolve) => {
        const timer = setTimeout(resolve, 45000);
        const h = (_e, v) => {
          if (v.state === "on" || v.state === "error" || v.state === "off") {
            clearTimeout(timer);
            internalEvents.removeListener("remote:status", h);
            resolve();
          }
        };
        internalEvents.on("remote:status", h);
      });
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
    const firstPage =
      choices && Array.isArray(choices.models) && choices.models.length
        ? `${APP_URL}/settings/local?auto=${encodeURIComponent(choices.models.join(","))}${choices.ollama ? "&ollama=1" : ""}`
        : APP_URL;
    stage("loading first page");
    const linkAtLoad = process.env.FILOW_PUBLIC_WEB || "";
    await win.loadURL(firstPage);
    stage("first page loaded");
    if (linkUp) {
      stage("waiting for public link");
      // Hold the splash until the public link is up (or 45 s), so the first QR already works from anywhere.
      splashStatus(cloudflaredPath() ? st("link") : st("download"));
      await linkUp;
      if ((process.env.FILOW_PUBLIC_WEB || "") !== linkAtLoad && !win.isDestroyed()) {
        stage("public link ready after the page, reloading");
        await win.loadURL(firstPage).catch(() => {});
      }
      stage("public link settled");
    }
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
        title: "Add your OpenRouter key",
        message: "No OPENROUTER_API_KEY set.",
        detail: `Open the config folder from the menu, put your key in .env, then restart the app.\n\n${envFile}`,
      });
    }
  } catch (err) {
    closeSplash();
    dialog.showErrorBox("Filow failed to start", String(err));
    app.quit();
  }
}

app.setAppUserModelId("com.intelliprompter.app");
app.whenReady().then(main);
app.on("window-all-closed", () => { if (!startupTransition) app.quit(); });
app.on("before-quit", () => { quitting = true; uiPreferences?.dispose(); okFilow?.dispose(); });
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopTunnels();
  if (httpsProxy) httpsProxy.close();
  if (stopSlideShowWatch) stopSlideShowWatch();
});
