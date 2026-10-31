// Desktop shell: runs the Next.js standalone server and the session relay inside
// Electron and opens the app in a window. Keys live in <userData>/.env, talking
// points in <userData>/script.md. Topology: ARCHITECTURE.md §5.3.
//   LAN mode (default): both servers bind 0.0.0.0 so a phone on the Wi-Fi can open
//     the mirror; the spend endpoints are gated by a per-launch random password.
//   Hosted mode: INTELLIPROMPTER_SESSION_URL (+ ACCESS_PASSWORD) in .env points the
//     engine at a public session server; local servers stay on 127.0.0.1.
const { app, BrowserWindow, Menu, shell, session, dialog, desktopCapturer, globalShortcut, ipcMain, screen } = require("electron");
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
let settings = { screenHotkey: DEFAULT_HOTKEY, screenSense: true, contentProtection: false, remoteShare: false, mirrorHost: "" };
function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) };
  } catch {
    /* first run */
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
const tunnels = { procs: [], web: "", session: "" };

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
async function ensureCloudflared(win) {
  const existing = cloudflaredPath();
  if (existing) return existing;
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const base = "https://github.com/cloudflare/cloudflared/releases/latest/download/";
  const asset =
    process.platform === "win32" ? `cloudflared-windows-${arch}.exe` : process.platform === "darwin" ? `cloudflared-darwin-${arch}.tgz` : `cloudflared-linux-${arch}`;
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Download", "Cancel"],
    defaultId: 0,
    title: "Share to a phone on another network",
    message: "This needs Cloudflare's free cloudflared tool (about 20 MB).",
    detail: `It will be downloaded once from\n${base}${asset}\ninto\n${path.join(userData, "bin")}\n\nWhile sharing is on, the mirror page and the session relay are reachable through random *.trycloudflare.com URLs. Pairing still needs the 6-digit code.`,
  });
  if (response !== 0) return null;
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
  delete process.env.INTELLIPROMPTER_PUBLIC_WEB;
  delete process.env.INTELLIPROMPTER_PUBLIC_SESSION;
}

async function setRemoteShare(win, on) {
  stopTunnels();
  settings.remoteShare = on;
  saveSettings();
  if (on) {
    try {
      if (offline) throw new Error("Offline mode is on; sharing needs outbound connections.");
      if (process.env.INTELLIPROMPTER_SESSION_URL) throw new Error("A hosted session server is configured in .env; its URL is already public.");
      const bin = await ensureCloudflared(win);
      if (!bin) {
        settings.remoteShare = false;
        saveSettings();
        buildMenu(win);
        return;
      }
      const [web, sess] = await Promise.all([startTunnel(bin, PORT), startTunnel(bin, SESSION_PORT)]);
      tunnels.web = web;
      tunnels.session = sess;
      process.env.INTELLIPROMPTER_PUBLIC_WEB = web;
      process.env.INTELLIPROMPTER_PUBLIC_SESSION = sess;
    } catch (err) {
      stopTunnels();
      settings.remoteShare = false;
      saveSettings();
      dialog.showErrorBox("Could not share to another network", String(err.message || err));
    }
  }
  buildMenu(win);
  win.reload(); // the preload re-reads the public URLs; the page creates a fresh session and QR
}

/** Which address the QR carries on the LAN: auto, one of the interfaces, or INTELLIPROMPTER_MIRROR_HOST from .env. */
function interfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) out.push({ name, address: i.address });
  }
  return out;
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
    callback({ cancel: !local });
  });
  win?.webContents.send("offline", offline);
}

function buildMenu(win) {
  const template = [
    {
      label: "Intelliprompter",
      submenu: [
        { label: "Open config folder (keys + script)", click: () => shell.openPath(userData) },
        { label: "Edit API keys (.env)", click: () => shell.openPath(envFile) },
        { label: "Local models & privacy settings", click: () => win.loadURL(APP_URL + "/settings/local") },
        { label: "Offline mode (local models only, no outbound requests)", type: "checkbox", checked: offline, click: (item) => applyOffline(win, item.checked) },
        { type: "separator" },
        {
          label: tunnels.web ? `Share to phone on any network (on: ${tunnels.web.replace("https://", "")})` : "Share to phone on any network (Cloudflare tunnel)",
          type: "checkbox",
          checked: settings.remoteShare && Boolean(tunnels.web),
          click: (item) => void setRemoteShare(win, item.checked),
        },
        {
          label: "Mirror address on this network",
          submenu: [
            { label: `Automatic (${lanIp()})`, type: "radio", checked: !settings.mirrorHost, click: () => applyMirrorHost(win, "") },
            ...interfaces().map((i) => ({ label: `${i.address}  (${i.name})`, type: "radio", checked: settings.mirrorHost === i.address, click: () => applyMirrorHost(win, i.address) })),
            { type: "separator" },
            { label: "Custom host: set INTELLIPROMPTER_MIRROR_HOST in .env", enabled: false },
          ],
        },
        {
          label: "Hide this window from screen recordings and screenshots",
          type: "checkbox",
          checked: settings.contentProtection,
          click: (item) => {
            settings.contentProtection = item.checked;
            saveSettings();
            win.setContentProtection(item.checked);
          },
        },
        { type: "separator" },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => win.reload() },
        { label: "Toggle fullscreen", accelerator: "F11", click: () => win.setFullScreen(!win.isFullScreen()) },
        { label: "Developer tools", accelerator: "CmdOrCtrl+Shift+I", click: () => win.webContents.toggleDevTools() },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function main() {
  try {
    seed(envFile, ".env.example");
    seed(scriptFile, "script.md");
    loadEnv(envFile);
    loadSettings();
    startServers();
  } catch (err) {
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
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "preload.js") },
  });
  mainWin = win;
  // §6.2: the window is already filtered out of Screen Sense's own chooser; hiding it from every
  // capture is opt-in (menu) because it also blanks the user's own screenshots.
  win.setContentProtection(Boolean(settings.contentProtection));
  buildMenu(win);
  applyOffline(win, offline);
  wireScreenSense();
  const hk = registerHotkey();
  if (!hk.ok) console.warn("Screen Sense hotkey:", hk.error);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    await waitFor(APP_URL + "/api/stt/status");
    if (!process.env.INTELLIPROMPTER_SESSION_URL) await waitFor(`http://127.0.0.1:${SESSION_PORT}/health`);
    await win.loadURL(APP_URL);
    if (settings.remoteShare) void setRemoteShare(win, true);
    if (!process.env.OPENROUTER_API_KEY) {
      dialog.showMessageBox(win, {
        type: "info",
        title: "Add your OpenRouter key",
        message: "No OPENROUTER_API_KEY set.",
        detail: `Open the config folder from the menu, put your key in .env, then restart the app.\n\n${envFile}`,
      });
    }
  } catch (err) {
    dialog.showErrorBox("Intelliprompter failed to start", String(err));
    app.quit();
  }
}

app.whenReady().then(main);
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopTunnels();
});
