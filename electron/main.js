// Desktop shell: runs the Next.js standalone server inside Electron and opens it in a window.
// Keys live in <userData>/.env, talking points in <userData>/script.md.
const { app, BrowserWindow, Menu, shell, session, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const PORT = Number(process.env.INTELLIPROMPTER_PORT || 4747);
const HOST = "127.0.0.1";
const URL = `http://${HOST}:${PORT}`;

const packaged = app.isPackaged;
const resources = packaged ? process.resourcesPath : path.join(__dirname, "..");
const serverDir = packaged ? path.join(resources, "app") : path.join(resources, ".next", "standalone");
const userData = app.getPath("userData");
const envFile = path.join(userData, ".env");
const scriptFile = path.join(userData, "script.md");

function seed(file, fromName) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(resources, fromName), file);
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

function startServer() {
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = HOST;
  process.env.NODE_ENV = "production";
  process.env.INTELLIPROMPTER_SCRIPT = scriptFile;
  // Next's standalone server starts listening when required.
  require(path.join(serverDir, "server.js"));
}

function waitForServer(tries = 100) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http
        .get(URL + "/api/stt/status", (res) => {
          res.resume();
          resolve();
        })
        .on("error", () =>
          n > 0 ? setTimeout(() => attempt(n - 1), 150) : reject(new Error("server did not start")),
        );
    };
    attempt(tries);
  });
}

function buildMenu(win) {
  const template = [
    {
      label: "Intelliprompter",
      submenu: [
        { label: "Open config folder (keys + script)", click: () => shell.openPath(userData) },
        { label: "Edit API keys (.env)", click: () => shell.openPath(envFile) },
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
    startServer();
  } catch (err) {
    dialog.showErrorBox("Intelliprompter failed to start", String(err && err.stack ? err.stack : err));
    app.quit();
    return;
  }

  // Microphone access for the transcription backends.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#0b0b0d",
    title: "Intelliprompter",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  buildMenu(win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    await waitForServer();
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
