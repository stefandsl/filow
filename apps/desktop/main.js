// Desktop shell: runs the Next.js standalone server and the session relay inside
// Electron and opens the app in a window. Keys live in <userData>/.env, talking
// points in <userData>/script.md. Topology: ARCHITECTURE.md §5.3.
//   LAN mode (default): both servers bind 0.0.0.0 so a phone on the Wi-Fi can open
//     the mirror; the spend endpoints are gated by a per-launch random password.
//   Hosted mode: INTELLIPROMPTER_SESSION_URL (+ ACCESS_PASSWORD) in .env points the
//     engine at a public session server; local servers stay on 127.0.0.1.
const { app, BrowserWindow, Menu, shell, session, dialog, desktopCapturer, globalShortcut, ipcMain, screen, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.INTELLIPROMPTER_PORT || 4747);
const SESSION_PORT = Number(process.env.INTELLIPROMPTER_SESSION_PORT || 4748);
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
const userData = app.getPath("userData");
const envFile = path.join(userData, ".env");
const scriptFile = path.join(userData, "script.md");
const settingsFile = path.join(userData, "settings.json");

// ---- Screen Sense (ARCHITECTURE.md §6.1): sources, region picker, global hotkey ----
const DEFAULT_HOTKEY = "CommandOrControl+Shift+Space";
let settings = { screenHotkey: DEFAULT_HOTKEY, screenSense: true, contentProtection: false, remoteShare: true, mirrorHost: "", lang: "", theme: "system", overlayAuto: true, overlayHidden: false, overlayOpacity: 0.94 };

// Menu strings. The page owns the choice (Settings / EN-IT switch) and tells us over IPC; "" = system locale.
const MENU_TEXT = {
  en: {
    configFolder: "Open config folder (keys + script)", editEnv: "Edit API keys (.env)", settings: "Local models & privacy settings",
    offline: "Offline mode (local models only, no outbound requests)", share: "Share to phone on any network (Cloudflare tunnel)",
    shareOn: "Share to phone on any network (on: {url})", mirrorAddress: "Mirror address on this network", automatic: "Automatic ({ip})",
    customHost: "Custom host: set INTELLIPROMPTER_MIRROR_HOST in .env", hideWindow: "Hide this window from screen recordings and screenshots",
    reload: "Reload", fullscreen: "Toggle fullscreen", devtools: "Developer tools", quit: "Quit",
    pptInstall: "Add Intelliprompter to PowerPoint on this PC",
    pptInstalled: "Done. Restart PowerPoint: Intelliprompter is on the Home tab (Add-ins group; on a Mac under Insert → My Add-ins). It talks to the app running on this PC, so keep Intelliprompter open while you present.",
    pptInstallFailed: "Could not add the add-in to PowerPoint.",
    pptRemove: "Remove Intelliprompter from PowerPoint on this PC",
    pptRemoved: "Removed. Restart PowerPoint.",
    pptWinOnly: "Automatic install works on Windows and macOS. On Linux there is no PowerPoint; save the manifest for another computer instead.",
    pptFirstRun: "Add Intelliprompter to PowerPoint?",
    pptFirstRunDetail: "A certificate for localhost is created and trusted for your user (the system asks once), and the add-in is registered for PowerPoint on this computer. You can undo it from the menu. On a Mac the pane runs in View mode (no microphone in Office for Mac): start the take here or on the phone.",
    pptYes: "Add to PowerPoint",
    pptNo: "Not now",
    pptManifest: "PowerPoint add-in: save manifest for another computer…",
    overlayShow: "Presenter overlay (points on top of the slide show)",
    overlayAuto: "Open the overlay automatically when a slide show starts",
    overlayHidden: "Hide the overlay from screen recordings and shares",
    updateCheck: "Check for updates…",
    updateChecking: "Checking for updates…",
    updateDownloading: "Downloading update {version}…",
    updateInstall: "Restart to install {version}",
    updateReady: "Intelliprompter {version} is ready.",
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
    customHost: "Host personalizzato: imposta INTELLIPROMPTER_MIRROR_HOST in .env", hideWindow: "Nascondi questa finestra da registrazioni e screenshot",
    reload: "Ricarica", fullscreen: "Schermo intero", devtools: "Strumenti per sviluppatori", quit: "Esci",
    pptInstall: "Aggiungi Intelliprompter a PowerPoint su questo PC",
    pptInstalled: "Fatto. Riavvia PowerPoint: Intelliprompter è nella scheda Home (gruppo Componenti aggiuntivi; su Mac in Inserisci → I miei componenti). Parla con l'app in esecuzione su questo PC, quindi tieni aperto Intelliprompter mentre presenti.",
    pptInstallFailed: "Impossibile aggiungere il componente a PowerPoint.",
    pptRemove: "Rimuovi Intelliprompter da PowerPoint su questo PC",
    pptRemoved: "Rimosso. Riavvia PowerPoint.",
    pptWinOnly: "L'installazione automatica funziona su Windows e macOS. Su Linux non c'è PowerPoint; salva il manifest per un altro computer.",
    pptFirstRun: "Aggiungere Intelliprompter a PowerPoint?",
    pptFirstRunDetail: "Viene creato un certificato per localhost, considerato attendibile per il tuo utente (il sistema chiede una volta), e il componente viene registrato per PowerPoint su questo computer. Puoi annullare dal menu. Su Mac il pannello funziona in modalità Vista (niente microfono in Office per Mac): avvia la registrazione qui o dal telefono.",
    pptYes: "Aggiungi a PowerPoint",
    pptNo: "Non ora",
    pptManifest: "Componente aggiuntivo PowerPoint: salva il manifest per un altro computer…",
    overlayShow: "Overlay relatore (punti sopra la presentazione)",
    overlayAuto: "Apri l'overlay da solo quando parte una presentazione",
    overlayHidden: "Nascondi l'overlay da registrazioni e condivisioni dello schermo",
    updateCheck: "Controlla aggiornamenti…",
    updateChecking: "Controllo aggiornamenti…",
    updateDownloading: "Scaricamento aggiornamento {version}…",
    updateInstall: "Riavvia per installare {version}",
    updateReady: "Intelliprompter {version} è pronto.",
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
function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) };
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
function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

let mainWin = null;
let selectedSourceId = null;
let pickerWin = null;

/** Screens and windows the user may watch, minus this app's own window. Thumbnails are small previews for the chooser. */
async function listSources() {
  const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
  const self = mainWin ? mainWin.getMediaSourceId() : "";
  return sources
    .filter((s) => s.id !== self && !/^Intelliprompter\b/.test(s.name))
    .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith("screen") ? "screen" : "window", thumbnail: s.thumbnail.isEmpty() ? "" : s.thumbnail.toDataURL() }));
}

/** Transparent full-display window; resolves to { display, rect } in display-relative CSS px, or null. */
function pickRegion() {
  if (pickerWin) return Promise.resolve(null);
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return new Promise((resolve) => {
    const { x, y, width, height } = display.bounds;
    pickerWin = new BrowserWindow({
      x, y, width, height,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
      hasShadow: false, enableLargerThanScreen: true, fullscreenable: false, show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "picker-preload.js") },
    });
    const finish = (rect) => {
      ipcMain.removeAllListeners("picker:done");
      ipcMain.removeAllListeners("picker:cancel");
      const w = pickerWin;
      pickerWin = null;
      if (w && !w.isDestroyed()) {
        w.hide(); // the overlay must be gone before the display is grabbed
        w.close();
      }
      setTimeout(() => resolve(rect ? { display, rect } : null), 120);
    };
    ipcMain.once("picker:done", (_e, rect) => finish(rect));
    ipcMain.once("picker:cancel", () => finish(null));
    pickerWin.on("closed", () => {
      if (pickerWin) finish(null);
    });
    pickerWin.setAlwaysOnTop(true, "screen-saver");
    pickerWin.loadFile(path.join(__dirname, "picker.html")).then(() => {
      if (!pickerWin) return;
      pickerWin.show();
      pickerWin.focus();
    });
  });
}

/** Grabs the display at native resolution and crops the chosen rect. JPEG data URL, memory only. */
async function captureRegion(display, rect) {
  const sf = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) },
  });
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || (sources.length === 1 ? sources[0] : null);
  if (!src || src.thumbnail.isEmpty()) throw new Error("could not capture the display");
  const img = src.thumbnail;
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
  ipcMain.handle("screen:sources", () => (settings.screenSense ? listSources() : Promise.reject(off())));
  ipcMain.handle("screen:select", (_e, id) => {
    selectedSourceId = settings.screenSense && typeof id === "string" ? id : null;
  });
  ipcMain.handle("screen:pickRegion", async () => {
    if (!settings.screenSense) throw off();
    const picked = await pickRegion();
    if (!picked) return null;
    return { image: await captureRegion(picked.display, picked.rect), width: picked.rect.width, height: picked.rect.height };
  });
  // The pairing dialog can switch the public link on/off; the window reloads with the new URLs.
  ipcMain.on("remote:set", (_e, on) => {
    if (mainWin && !mainWin.isDestroyed()) void setRemoteShare(mainWin, Boolean(on));
  });
  ipcMain.handle("update:status", () => ({ ...updateState, current: app.getVersion() }));
  ipcMain.on("update:check", () => void checkForUpdates({ manual: true }));
  ipcMain.on("update:install", () => loadUpdater() && updateState.status === "downloaded" && updater.quitAndInstall());
  ipcMain.handle("remote:status", () => ({ state: tunnels.state, url: tunnels.web, error: tunnels.error, wanted: Boolean(settings.remoteShare) }));
  ipcMain.on("session:report", (_e, info) => {
    if (info && typeof info.code === "string" && typeof info.id === "string") {
      const changedSession = !currentSession || currentSession.id !== info.id;
      currentSession = { id: info.id, code: info.code };
      if (changedSession && overlayWin && !overlayWin.isDestroyed()) overlayWin.loadURL(overlayUrl());
    }
  });
  ipcMain.on("ui:theme", (_e, theme) => {
    if (theme !== "system" && theme !== "light" && theme !== "dark") return;
    settings.theme = theme;
    saveSettings();
    nativeTheme.themeSource = theme;
  });
  ipcMain.on("ui:lang", (_e, lang) => {
    if (lang !== "en" && lang !== "it") return;
    settings.lang = lang;
    saveSettings();
    if (mainWin && !mainWin.isDestroyed()) buildMenu(mainWin);
  });
  ipcMain.handle("screen:settings", () => ({ hotkey: settings.screenHotkey, enabled: settings.screenSense }));
  ipcMain.handle("screen:setSettings", (_e, next) => {
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

function lanIp() {
  const fromEnv = (process.env.INTELLIPROMPTER_MIRROR_HOST || "").trim();
  if (fromEnv) return fromEnv;
  if (settings.mirrorHost) return settings.mirrorHost;
  // Prefer a private LAN address (phones on the same Wi-Fi) over VPN/CGNAT ranges such as Tailscale's 100.64/10.
  const all = interfaces().map((i) => i.address);
  const isPrivate = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  return all.find(isPrivate) || all[0] || "127.0.0.1";
}

// ---- Phone on another network: Cloudflare quick tunnel (README "Phone on another network") ----
// `cloudflared tunnel --url` gives a public https URL with no account. One tunnel for the
// web app (the mirror page) and one for the session relay. The QR then carries public URLs,
// so a phone on mobile data pairs like WhatsApp Web. Spend endpoints stay behind the engine
// token; pairing needs the 6-digit code and is rate limited.
const { spawn, execFileSync } = require("node:child_process");
const https = require("node:https");
const tunnels = { procs: [], web: "", session: "", state: "off", error: "" };

/** Public-link state for the pairing dialog: off | downloading | connecting | on | error. */
function remoteStatus(state, error = "") {
  tunnels.state = state;
  tunnels.error = error;
  logLine(`public link: ${state}${error ? " " + error : ""}`);
  ipcMain.emit("remote:status:internal", null, { state, url: tunnels.web, error });
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
      .get(url, { headers: { "User-Agent": "Intelliprompter" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops > 0) {
          res.resume();
          return download(res.headers.location, dest, hops - 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) return reject(new Error(`download failed: HTTP ${res.statusCode}`));
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close(resolve));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

/** Official cloudflared binary from GitHub releases, into <userData>/bin. Asks first. */
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
    execFileSync("tar", ["-xzf", tgz, "-C", bin]);
    fs.rmSync(tgz, { force: true });
  } else {
    await download(base + asset, dest);
  }
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
  return dest;
}

function startTunnel(bin, port) {
  return new Promise((resolve, reject) => {
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
  });
}

function stopTunnels() {
  for (const p of tunnels.procs) {
    try {
      p.kill();
    } catch {
      /* already gone */
    }
  }
  tunnels.procs = [];
  tunnels.web = tunnels.session = "";
  tunnels.state = "off";
  delete process.env.INTELLIPROMPTER_PUBLIC_WEB;
  delete process.env.INTELLIPROMPTER_PUBLIC_SESSION;
  delete process.env.TRUST_PROXY;
}

/**
 * The public link is on by default (WhatsApp-style pairing: the QR works from any network).
 * `auto` = at start-up: no dialogs, failures only show in the pairing dialog and the app keeps
 * working on the LAN. From the menu or the dialog the user gets the download question and errors.
 */
let remoteBusy = false;
async function setRemoteShare(win, on, { auto = false } = {}) {
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
        if (process.env.INTELLIPROMPTER_SESSION_URL) throw new Error("A hosted session server is configured in .env; its URL is already public.");
        remoteStatus("connecting");
        const bin = await ensureCloudflared(win, { silent: auto });
        if (!bin) {
          settings.remoteShare = false;
          saveSettings();
          remoteStatus("off");
          buildMenu(win);
          win.reload();
          return;
        }
        remoteStatus("connecting");
        const [web, sess] = await Promise.all([startTunnel(bin, PORT), startTunnel(bin, SESSION_PORT)]);
        tunnels.web = web;
        tunnels.session = sess;
        process.env.INTELLIPROMPTER_PUBLIC_WEB = web;
        process.env.INTELLIPROMPTER_PUBLIC_SESSION = sess;
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
    win.reload(); // the preload re-reads the public URLs; the page creates a fresh session and QR
  } finally {
    remoteBusy = false;
  }
}

/** Which address the QR carries on the LAN: auto, one of the interfaces, or INTELLIPROMPTER_MIRROR_HOST from .env. */
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
// and the registry value. PowerPoint then shows "Intelliprompter" on the Home tab.
const net = require("node:net");
const HTTPS_PORT = Number(process.env.INTELLIPROMPTER_HTTPS_PORT || 4749);
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
      "-keyout", pemKey, "-out", pemCert, "-subj", "/CN=localhost/O=Intelliprompter",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-addext", "extendedKeyUsage=serverAuth",
    ]);
    const keychain = path.join(os.homedir(), "Library", "Keychains", "login.keychain-db");
    await runCommand("security", ["add-trusted-cert", "-d", "-r", "trustRoot", "-k", keychain, pemCert]);
    return;
  }
  fs.mkdirSync(certDir, { recursive: true });
  settings.pfxPassword = crypto.randomBytes(12).toString("base64url");
  saveSettings();
  const ps = `
$ErrorActionPreference = 'Stop'
$cert = New-SelfSignedCertificate -DnsName 'localhost','127.0.0.1' -CertStoreLocation 'Cert:\\CurrentUser\\My' -FriendlyName 'Intelliprompter localhost' -NotAfter (Get-Date).AddYears(5) -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048
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
  if (process.platform !== "win32" || settings.certTrusted) return;
  const cer = path.join(certDir, "localhost.cer");
  if (!fs.existsSync(cer)) {
    // cer missing but pfx present (older install): re-export it from the user store
    await runPowerShell(`$c = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.FriendlyName -eq 'Intelliprompter localhost' } | Select-Object -First 1; if (-not $c) { throw 'certificate not found' }; Export-Certificate -Cert $c -FilePath '${cer.replace(/'/g, "''")}' | Out-Null`);
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
  const hosted = Boolean(process.env.INTELLIPROMPTER_SESSION_URL);
  const tls = process.platform === "win32" ? { pfx: fs.readFileSync(pfxFile), passphrase: settings.pfxPassword } : { key: fs.readFileSync(pemKey), cert: fs.readFileSync(pemCert) };
  const server = https.createServer(tls, (req, res) => {
    if (req.url === "/api/local/current-session") {
      // Only reachable from this machine (the proxy listens on 127.0.0.1): the PowerPoint pane joins the app's session.
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
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
    fs.copyFileSync(pptManifestFile, path.join(macWefDir, "intelliprompter.manifest.xml"));
    return;
  }
  const key = "HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer";
  await runPowerShell(`New-Item -Path 'Registry::${key}' -Force | Out-Null; New-ItemProperty -Path 'Registry::${key}' -Name 'Intelliprompter' -Value '${pptManifestFile.replace(/'/g, "''")}' -PropertyType String -Force | Out-Null`);
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
    if (process.platform === "darwin") fs.rmSync(path.join(macWefDir, "intelliprompter.manifest.xml"), { force: true });
    else await runPowerShell(`Remove-ItemProperty -Path 'Registry::HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer' -Name 'Intelliprompter' -ErrorAction SilentlyContinue`);
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
      if (mainWin && !mainWin.isDestroyed()) {
        dialog
          .showMessageBox(mainWin, {
            type: "info",
            buttons: [mt("updateRestart"), mt("updateLater")],
            defaultId: 0,
            title: "Intelliprompter",
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
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send("update:status", { ...updateState, current: app.getVersion() });
    buildMenu(mainWin);
  }
}

async function checkForUpdates({ manual = false } = {}) {
  if (!packaged) {
    if (manual) dialog.showMessageBox(mainWin, { type: "info", title: "Intelliprompter", message: "Updates only work in the installed app." });
    return;
  }
  if (offline) {
    if (manual) dialog.showMessageBox(mainWin, { type: "info", title: "Intelliprompter", message: mt("updateOffline") });
    return;
  }
  const u = loadUpdater();
  if (!u) return;
  try {
    const r = await u.checkForUpdates();
    if (manual && r && r.updateInfo && r.updateInfo.version === app.getVersion()) {
      dialog.showMessageBox(mainWin, { type: "info", title: "Intelliprompter", message: mt("updateNone", { version: app.getVersion() }) });
    }
  } catch (err) {
    if (manual) dialog.showMessageBox(mainWin, { type: "warning", title: "Intelliprompter", message: mt("updateFailed"), detail: String(err.message || err) });
  }
}


// ---- Splash screen and first-start choices from the installer ----
let splash = null;
let splashShownAt = 0;
const SPLASH_MIN_MS = Number(process.env.INTELLIPROMPTER_SPLASH_MIN_MS || 1800);
/** Plain-text startup log in userData (startup.log): which step ran, and any error the splash or link hit. */
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
    backgroundColor: uiTheme() === "dark" ? "#0b0b0d" : "#f7f7f8", title: "Intelliprompter",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const q = new URLSearchParams({ v: app.getVersion(), theme: uiTheme(), local: local ? "1" : "0", lang: menuLang() });
  splashShownAt = Date.now();
  splash
    .loadFile(path.join(__dirname, "splash.html"), { query: Object.fromEntries(q) })
    .then(() => {
      if (splash && !splash.isDestroyed()) {
        splash.show();
        logLine("splash shown");
      }
    })
    .catch((err) => logLine(`splash failed: ${err && err.message ? err.message : err}`));
  splash.on("closed", () => (splash = null));
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
    if (choices.lang === "it" || choices.lang === "en") {
      settings.lang = choices.lang;
      saveSettings();
    }
    return choices;
  } catch {
    return null;
  }
}


// ---- Presenting: follow the slide show and show the presenter overlay ----
const { watchSlideShow } = require("./slideshow");
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
    backgroundColor: uiTheme() === "dark" ? "#0b0b0d" : "#f7f7f8",
    title: "Intelliprompter overlay",
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "preload.js") },
  });
  overlayWin.setAlwaysOnTop(true, "screen-saver");
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
    defaultPath: path.join(app.getPath("documents"), "Intelliprompter.manifest.xml"),
    filters: [{ name: "Office manifest", extensions: ["xml"] }],
  });
  if (!filePath) return;
  fs.writeFileSync(filePath, buildManifest(origin, { id: settings.manifestId }));
  dialog.showMessageBox(win, { type: "info", title: "PowerPoint", message: mt("pptSaved", { origin }) });
}

function applyMirrorHost(win, host) {
  settings.mirrorHost = host;
  saveSettings();
  process.env.INTELLIPROMPTER_LAN_IP = host || lanIp();
  process.env.PUBLIC_ORIGIN = `http://${process.env.INTELLIPROMPTER_LAN_IP}:${PORT}`;
  buildMenu(win);
  win.reload();
}


function startServers() {
  const hosted = Boolean(process.env.INTELLIPROMPTER_SESSION_URL);
  const bind = hosted ? "127.0.0.1" : "0.0.0.0";
  if (!hosted) {
    // LAN mode: gate the spend endpoints with a per-launch secret that only this window knows.
    process.env.ACCESS_PASSWORD = crypto.randomBytes(16).toString("base64url");
    process.env.AUTO_ACCEPT_LAN = "1"; // phones on this Wi-Fi join without a prompt; tunnel peers are asked
    process.env.INTELLIPROMPTER_LAN_IP = lanIp();
  }
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = bind;
  process.env.SESSION_PORT = String(SESSION_PORT);
  process.env.SESSION_HOST = bind;
  process.env.NODE_ENV = "production";
  process.env.INTELLIPROMPTER_SCRIPT = scriptFile;
  process.env.PUBLIC_ORIGIN = `http://${process.env.INTELLIPROMPTER_LAN_IP || "127.0.0.1"}:${PORT}`;
  require(webServer); // Next's standalone server starts listening when required
  if (!hosted) require(sessionServer); // relay in-process; hosted mode uses the remote one
}

function waitFor(url, tries = 100) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => (n > 0 ? setTimeout(() => attempt(n - 1), 150) : reject(new Error(`server did not start: ${url}`))));
    };
    attempt(tries);
  });
}

/**
 * Offline mode: every provider becomes local and the renderer can only reach this
 * machine (the local servers and Ollama). Toggled from the menu; the server-side
 * provider resolution reads the same flag through process.env.
 */
let offline = process.env.INTELLIPROMPTER_OFFLINE === "1";
function applyOffline(win, value) {
  offline = value;
  process.env.INTELLIPROMPTER_OFFLINE = value ? "1" : "";
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
    const local = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === process.env.INTELLIPROMPTER_LAN_IP;
    // (the HTTPS proxy on localhost:HTTPS_PORT is covered by "localhost")
    callback({ cancel: !local });
  });
  win?.webContents.send("offline", offline);
}

function buildMenu(win) {
  const template = [
    {
      label: "Intelliprompter",
      submenu: [
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
            ...interfaces().map((i) => ({ label: `${i.address}  (${i.name})`, type: "radio", checked: settings.mirrorHost === i.address, click: () => applyMirrorHost(win, i.address) })),
            { type: "separator" },
            { label: mt("customHost"), enabled: false },
          ],
        },
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

async function main() {
  let choices = null;
  try {
    seed(envFile, ".env.example");
    seed(scriptFile, "script.md");
    loadEnv(envFile);
    loadSettings();
    choices = readInstallChoices();
    showSplash();
    splashStatus(st("servers"));
    startServers();
  } catch (err) {
    closeSplash();
    dialog.showErrorBox("Intelliprompter failed to start", String(err && err.stack ? err.stack : err));
    app.quit();
    return;
  }

  // Microphone and screen capture for the engine.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media" || permission === "display-capture");

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#0b0b0d",
    title: "Intelliprompter",
    show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "preload.js") },
  });
  mainWin = win;
  nativeTheme.themeSource = settings.theme === "light" || settings.theme === "dark" ? settings.theme : "system";
  // §6.2: the window is already filtered out of Screen Sense's own chooser; hiding it from every
  // capture is opt-in (menu) because it also blanks the user's own screenshots.
  win.setContentProtection(Boolean(settings.contentProtection));
  buildMenu(win);
  applyOffline(win, offline);
  wireScreenSense();
  startSlideShowWatch();
  ipcMain.handle("slideshow:state", () => slideShow);
  ipcMain.on("overlay:close", () => hideOverlay());
  const hk = registerHotkey();
  if (!hk.ok) console.warn("Screen Sense hotkey:", hk.error);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    await waitFor(APP_URL + "/api/stt/status");
    if (!process.env.INTELLIPROMPTER_SESSION_URL) await waitFor(`http://127.0.0.1:${SESSION_PORT}/health`);
    const firstPage = choices && Array.isArray(choices.models) && choices.models.length ? `${APP_URL}/settings/local?auto=${encodeURIComponent(choices.models.join(","))}` : APP_URL;
    await win.loadURL(firstPage);
    if (settings.remoteShare && !offline && !process.env.INTELLIPROMPTER_SESSION_URL) {
      // Hold the splash until the public link is up (or 45 s), so the first QR already works from anywhere.
      splashStatus(cloudflaredPath() ? st("link") : st("download"));
      const linkUp = new Promise((resolve) => {
        const done = () => resolve();
        const timer = setTimeout(done, 45000);
        const h = (_e, v) => {
          if (v.state === "on" || v.state === "error" || v.state === "off") {
            clearTimeout(timer);
            ipcMain.removeListener("remote:status:internal", h);
            done();
          }
        };
        ipcMain.on("remote:status:internal", h);
      });
      void setRemoteShare(win, true, { auto: true });
      await linkUp;
    }
    splashStatus(st("ready"), true);
    const wait = Math.max(400, SPLASH_MIN_MS - (Date.now() - splashShownAt));
    setTimeout(() => {
      closeSplash();
      if (!win.isDestroyed()) win.show();
      logLine("main window shown");
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
    dialog.showErrorBox("Intelliprompter failed to start", String(err));
    app.quit();
  }
}

app.whenReady().then(main);
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopTunnels();
  if (httpsProxy) httpsProxy.close();
  if (stopSlideShowWatch) stopSlideShowWatch();
});
