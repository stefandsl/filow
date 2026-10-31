// Desktop shell: runs the Next.js standalone server and the session relay inside
// Electron and opens the app in a window. Keys live in <userData>/.env, talking
// points in <userData>/script.md. Topology: ARCHITECTURE.md §5.3.
//   LAN mode (default): both servers bind 0.0.0.0 so a phone on the Wi-Fi can open
//     the mirror; the spend endpoints are gated by a per-launch random password.
//   Hosted mode: INTELLIPROMPTER_SESSION_URL (+ ACCESS_PASSWORD) in .env points the
//     engine at a public session server; local servers stay on 127.0.0.1.
const { app, BrowserWindow, Menu, shell, session, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");

const PORT = Number(process.env.INTELLIPROMPTER_PORT || 4747);
const SESSION_PORT = Number(process.env.INTELLIPROMPTER_SESSION_PORT || 4748);
const URL = `http://127.0.0.1:${PORT}`;

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
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
  }
  return "127.0.0.1";
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
        { label: "Local models & privacy settings", click: () => win.loadURL(URL + "/settings/local") },
        { label: "Offline mode (local models only, no outbound requests)", type: "checkbox", checked: offline, click: (item) => applyOffline(win, item.checked) },
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
  buildMenu(win);
  applyOffline(win, offline);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    await waitFor(URL + "/api/stt/status");
    if (!process.env.INTELLIPROMPTER_SESSION_URL) await waitFor(`http://127.0.0.1:${SESSION_PORT}/health`);
    await win.loadURL(URL);
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
