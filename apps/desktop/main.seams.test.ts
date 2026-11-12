import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { DICTIONARIES, isLang, langFromLocale, t } from "@filow/core";
// localai.js reads the setup rules and the card detection from vendor/, a build of these two files
// (npm run build:welcome); vendor/ is not in git, so the fixture hands it the sources themselves.
import * as profileRules from "../../packages/core/src/profile";
import * as hardwareRules from "../../packages/core/src/hardware";

/** Evaluate untouched main.js, with startup held and all effects replaced in-process. */
function fixture(initialEnv: Record<string, string> = {}, { updateFeed = false, childProcess = {} as Record<string, unknown>, lockHeld = false, platform = "win32", qaBuild = false } = {}) {
  // every dictionary key the shell asks for while it runs, literal or computed (mt(k), tx(key), `catalog.${n}`)
  const asked = new Set<string>();
  const recordingT = (key: string, lang: string, vars?: Record<string, string | number>) => { asked.add(key); return t(key, lang as Parameters<typeof t>[1], vars); };
  const env = { ...initialEnv };
  // single instance: the order of profile and lock calls, the app's event handlers, exit and start
  const calls: string[] = [], appHandlers: Record<string, (...args: any[]) => void> = {};
  const appExit = vi.fn(), whenReady = vi.fn(() => ({ then() {} })), processExit = vi.fn((code: number) => { calls.push(`process.exit ${code}`); });
  // windows main.js (and about.js) create, and the ipcMain.handle channels they register
  const windows: any[] = [], ipcHandlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {};
  class FakeBrowserWindow extends EventEmitter {
    static getAllWindows() { return []; }
    webContents = Object.assign(new EventEmitter(), { send: vi.fn(), setWindowOpenHandler: vi.fn() });
    loaded: unknown[] = [];
    constructor(public options: unknown) { super(); windows.push(this); }
    loadFile(file: string, options: unknown) { this.loaded.push([file, options]); return Promise.resolve(); }
    setMenuBarVisibility() {} isDestroyed() { return false; } isMinimized() { return false; } show() {} focus() {} restore() {} close() {}
  }
  let requestFilter!: (details: { url: string }, cb: (r: unknown) => void) => void;
  const outbound = vi.fn(() => { throw new Error("fake network boundary: no bytes sent"); });
  const openExternal = vi.fn(async () => {}), checkForUpdates = vi.fn(async () => null);
  const registerShortcut = vi.fn(() => true);
  const writeText = vi.fn(), showMessageBox = vi.fn(async () => ({ response: 0 }));
  const updaterHandlers: Record<string, (info: { version: string }) => void> = {}, notificationShow = vi.fn();
  const writeFileSync = vi.fn(), appendFileSync = vi.fn(), rmSync = vi.fn(), fsRead = vi.fn((..._args: unknown[]) => "FILOW_OFFLINE=1");
  const modules: Record<string, any> = {
    electron: {
      crashReporter: { start() {} },
      app: { isPackaged: true, getPath: () => "G:/fake", setPath: (name: string, value: string) => { calls.push(`setPath ${name} ${value}`); },
        on: (event: string, fn: (...args: any[]) => void) => { appHandlers[event] = fn; }, setAppUserModelId() {},
        requestSingleInstanceLock: () => { calls.push("lock"); return !lockHeld; }, exit: appExit,
        whenReady, getLocale: () => "en", getVersion: () => "test", getGPUInfo: async () => ({}), commandLine: { appendSwitch: (...a: string[]) => { calls.push(`switch ${a.join(" ")}`); } } },
      ipcMain: { on() {}, handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => { ipcHandlers[channel] = fn; } }, BrowserWindow: FakeBrowserWindow,
      session: { defaultSession: { webRequest: { onBeforeRequest: (_filter: unknown, cb: typeof requestFilter) => { requestFilter = cb; } } } },
      shell: { openExternal }, dialog: { showMessageBox }, clipboard: { writeText }, globalShortcut: { register: registerShortcut, unregisterAll() {} },
      Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu() {} },
      Notification: class { static isSupported() { return true; } on() {} show() { notificationShow(); } },
      net: { isOnline: () => true }, nativeTheme: { shouldUseDarkColors: true },
    },
    "node:path": path, "node:url": { pathToFileURL },
    "node:fs": { readFileSync: fsRead, appendFileSync, existsSync: (file: string) => updateFeed && String(file).endsWith("app-update.yml"), mkdirSync() {}, rmSync, writeFileSync, renameSync() {} },
    "node:os": { homedir: () => "G:/fake", cpus: () => [{ model: "fake" }], totalmem: () => 0, release: () => "fake", networkInterfaces: () => ({}) },
    "node:http": { get: () => { const req = new EventEmitter(); queueMicrotask(() => req.emit("error", new Error("Ollama absent"))); return req; } },
    "node:https": { get: outbound }, "node:crypto": {}, "node:net": {}, "node:child_process": childProcess,
    "node:worker_threads": {}, "node:events": EventEmitter,
    "./stt-download": { idleTimeout: () => ({ stop() {} }), retryDownload: (operation: () => unknown) => operation() },
    "./integrity": { sha256File: async () => "" },
    "./vendor/i18n": { t: recordingT, isLang, langFromLocale }, "./vendor/profile": profileRules, "./vendor/hardware": hardwareRules, "./ui-preferences": {}, "./slideshow": {},
    "./package.json": { sourceSha: "0123456789abcdef0123456789abcdef01234567" }, // what CI writes into the packed package.json
    "./qa.js": { isQaBuild: (app: { isPackaged: boolean }) => qaBuild || !app.isPackaged }, // a packaged build, without the QA marker unless qaBuild
    "./points-window": { createFloatingWindow() {}, createPointsWindow: () => ({ isOpen: () => false, owns: () => false, webContents: () => null, reload() {}, set() {}, hide() {}, show() {} }) },
  };
  // Real downloader orchestration, absent installation/model, fake disk and network.
  for (const name of ["global-input", "model-files", "download", "model-roles", "stt", "localai", "diag", "s1-runtime", "welcome-setup", "single-instance", "about"]) {
    const module = { exports: {} };
    runInNewContext(readFileSync(new URL(`./${name}.js`, import.meta.url), "utf8"), {
      require: (id: string) => { if (!(id in modules)) throw new Error(`unexpected dependency: ${id}`); return modules[id]; },
      module, process: { env, platform }, URL, setTimeout, clearTimeout, AbortController, __dirname: "G:/fake",
    });
    modules[`./${name}`] = module.exports;
  }
  // the pure tunnel rules, as main.js asks for them
  modules["./tunnels.js"] = createRequire(import.meta.url)("./tunnels.js");
  const api = runInNewContext(readFileSync(new URL("./main.js", import.meta.url), "utf8") + `
    ;({ applyOffline, loadEnv, aliasLegacyEnv, sttDownload, sttStatus, startOllamaInstall, localAiStatus: () => localAiState, reportProblem, openAbout: view => about().open(view), checkForUpdates,
       startupOffline: () => applyOffline(null), tunnels, stopTunnels, setRemoteShare, linkForPairing, dropInstallerChoices, setLog: text => { lastTakeLog = text; },
       setTakeLive, loadUpdater, setMainWin: win => { mainWin = win; }, setLang: lang => { settings.lang = lang; },
       guardNavigation, endTakeWithPage, APP_URL, setSlideShowRunning: running => { slideShow = { ...slideShow, running }; },
       offerLocalAi, offerFirewall, welcomeSetup, registerHotkey, permissionFor, copyText: text => clipboard.writeText(text), settings: () => settings, patchSettings: patch => Object.assign(settings, patch),
       onWelcomeReady, welcomeOfferForStep, chooseWelcomeSetup, setWelcomeWin: win => { welcomeWin = win; }, buildMenu, st,
       setLocalAiHardware: hw => { localAiHardware = Promise.resolve(hw); } });`, {
    require: (id: string) => {
      if (id.endsWith("electron-updater.js")) return { autoUpdater: { on(event: string, fn: (info: { version: string }) => void) { updaterHandlers[event] = fn; }, checkForUpdates, quitAndInstall() {} } };
      if (!(id in modules)) throw new Error(`unexpected dependency: ${id}`);
      return modules[id];
    },
    __dirname: "G:/fake", process: { env, platform, arch: "x64", resourcesPath: "G:/fake", versions: {}, on() {}, exit: processExit },
    URL, URLSearchParams, console, setTimeout, clearTimeout, AbortController,
  });
  return { api, env, registerShortcut, outbound, openExternal, checkForUpdates, writeText, showMessageBox, updaterHandlers, notificationShow, writeFileSync, appendFileSync, rmSync, fsReads: fsRead,
    calls, appHandlers, appExit, processExit, whenReady, windows, asked, catalog: Object.keys(modules["./localai"].CATALOG),
    ipc: async (channel: string, win: { webContents: unknown }, ...args: unknown[]) => ipcHandlers[channel]({ sender: win.webContents }, ...args),
    blocked: (url: string) => { let result: any; requestFilter({ url }, r => { result = r; }); return result.cancel === true; } };
}

describe("Step 4 desktop offline seams", () => {
  it("process-level offline blocks new renderer cloud requests and update checks", async () => {
    // with an update feed, or the check stops at "not an installed app" before it looks at offline
    const f = fixture({ FILOW_OFFLINE: "1" }, { updateFeed: true }); f.api.startupOffline();
    expect(f.blocked("https://cloud.invalid/upload")).toBe(true);
    expect(f.blocked("http://127.0.0.1:4747/api/decide")).toBe(false);
    await f.api.checkForUpdates(); expect(f.checkForUpdates).not.toHaveBeenCalled();
  });
  it("an installed app that is online does ask the update feed", async () => {
    const f = fixture({}, { updateFeed: true });
    await f.api.checkForUpdates(); expect(f.checkForUpdates).toHaveBeenCalledOnce();
  });
  // Contract: ARCHITECTURE.md §6.10 FILOW_OFFLINE; main.js loads profile .env for app configuration.
  it("profile env offline must survive desktop startup", () => {
    const f = fixture(); f.api.loadEnv("G:/fake/.env");
    expect(f.env.FILOW_OFFLINE).toBe("1");
    // Startup reads the loaded/aliased env; explicit menu toggles still pass a boolean.
    f.api.startupOffline();
    expect(f.env.FILOW_OFFLINE, "startup must retain FILOW_OFFLINE=1 loaded from profile").toBe("1");
    expect(f.blocked("https://cloud.invalid/upload")).toBe(true);
  });
  it("legacy offline env survives startup and explicit toggles can disable it", () => {
    const f = fixture({ INTELLIPROMPTER_OFFLINE: "1" }); f.api.aliasLegacyEnv(); f.api.startupOffline();
    expect(f.env.FILOW_OFFLINE).toBe("1");
    f.api.applyOffline(null, false);
    expect(f.env.FILOW_OFFLINE).toBe("");
    expect(f.blocked("https://cloud.invalid/upload")).toBe(false);
  });
  // Contract: main.js offline menu: "no outbound requests"; ARCHITECTURE.md §6.10.
  it("enabling offline must stop an already running public tunnel", () => {
    const f = fixture(); const kill = vi.fn();
    f.api.tunnels.procs.push({ kill }); f.api.tunnels.web = "https://fake.trycloudflare.com";
    f.api.applyOffline(null, true);
    expect(kill, "offline transition must stop existing cloudflared transport").toHaveBeenCalledOnce();
    expect(f.api.tunnels.procs).toHaveLength(0);
    expect(f.api.tunnels.web).toBe("");
    expect(f.api.tunnels.state).toBe("off");
  });
  // taskkill takes up to a second per process and the main process also serves the pages: a start whose
  // public link failed froze for about 2.5 s while it waited for two of them (measured on the package).
  it("stopping a tunnel while the app runs does not wait for taskkill; at quit it does", () => {
    const execFile = vi.fn(), execFileSync = vi.fn();
    const f = fixture({}, { childProcess: { execFile, execFileSync } });
    f.api.tunnels.procs.push({ pid: 4321, kill: vi.fn() }, { pid: 4322, kill: vi.fn() });
    f.api.stopTunnels();
    expect(execFileSync).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile.mock.calls[0].slice(0, 2)).toEqual(["taskkill", ["/PID", "4321", "/T", "/F"]]);
    expect(f.api.tunnels.procs).toHaveLength(0);
    f.api.tunnels.procs.push({ pid: 4323, kill: vi.fn() });
    f.api.stopTunnels({ wait: true });
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync.mock.calls[0].slice(0, 2)).toEqual(["taskkill", ["/PID", "4323", "/T", "/F"]]);
  });
  it("a public link start with cloudflared already there logs \"connecting\" once", async () => {
    const execFileSync = vi.fn((cmd: string) => (cmd === "where" ? "G:/bin/cloudflared.exe\r\n" : ""));
    const spawn = vi.fn(() => { throw new Error("no tunnels in tests"); });
    const f = fixture({}, { childProcess: { execFile: vi.fn(), execFileSync, spawn } });
    await f.api.setRemoteShare({ reload() {} }, true, { auto: true, reload: false });
    const lines = f.appendFileSync.mock.calls.map((c: unknown[]) => String(c[1])).filter((l: string) => l.includes("public link:"));
    expect(lines.map((l: string) => l.replace(/^\S+ /, "").trim())).toEqual(["public link: connecting", "public link: error no tunnels in tests"]);
  });
  // Contract: main.js offline menu: "no outbound requests" (includes main-process setup downloads).
  it("offline must block the desktop STT model downloader", async () => {
    const f = fixture({ FILOW_OFFLINE: "1" }); await f.api.sttDownload();
    expect(f.outbound, "offline must not enter the network model downloader").not.toHaveBeenCalled();
    expect(f.api.sttStatus()).toMatchObject({ model: "error", error: t("offline.downloadDisabled", "en") });
  });
  // Contract: main.js offline menu: "no outbound requests" (includes main-process setup downloads).
  it("offline must block the Ollama installer downloader", async () => {
    const f = fixture({ FILOW_OFFLINE: "1" }); await f.api.startOllamaInstall();
    expect(f.outbound, "offline must not enter the network installer").not.toHaveBeenCalled();
    expect(f.api.localAiStatus()).toMatchObject({ state: "error", error: t("offline.downloadDisabled", "en") });
  });
  // Contract: "Report a problem" sends nothing by itself (docs/PRIVACY.md): online or offline it opens the
  // local report window. The report leaves only when the user presses "Open an issue on GitHub" there.
  it.each([{}, { FILOW_OFFLINE: "1" }])("a report opens the local report window and no browser (env %o)", async (env) => {
    const f = fixture(env); f.api.setLog("synthetic private take log");
    f.api.reportProblem();
    expect(f.openExternal, "no report text may leave through a browser URL").not.toHaveBeenCalled();
    expect(f.windows).toHaveLength(1);
    expect(f.windows[0].loaded).toEqual([[path.join("G:/fake", "about.html"), { hash: "report" }]]);
    const r = await f.ipc("report:data", f.windows[0]);
    expect(r.preview).toContain("synthetic private take log");
    expect(f.writeText).not.toHaveBeenCalled();
  });
  it("the report masks a live public link and keys before the user sees or saves it", async () => {
    const f = fixture({});
    // the key is built from pieces so no key-shaped string sits in a tracked file (SUP-05 scans them)
    f.api.setLog("phone joined via https://drives-pulling-agrees-ambassador.trycloudflare.com/s/1 with sk-or-v1-" + "0123456789abcdef".repeat(2));
    f.api.reportProblem();
    const { preview } = await f.ipc("report:data", f.windows[0]);
    expect(preview).toContain("phone joined via <public link> with <key>");
    expect(preview).not.toMatch(/trycloudflare|sk-or-v1-0123/);
    await f.ipc("report:copy", f.windows[0], "my words");
    expect(String(f.writeText.mock.calls[0][0])).toMatch(/my words[\s\S]*<public link>/);
  });
  it("the GitHub issue button hands the browser one https link holding the masked report, nothing more", async () => {
    const f = fixture({});
    f.api.setLog("phone joined via https://drives-pulling-agrees-ambassador.trycloudflare.com/s/1 with sk-or-v1-" + "0123456789abcdef".repeat(2));
    f.api.reportProblem();
    await f.ipc("report:data", f.windows[0]);
    expect(f.openExternal).not.toHaveBeenCalled();
    expect(await f.ipc("report:issue", f.windows[0], "my words")).toMatchObject({ opened: true });
    expect(f.openExternal).toHaveBeenCalledOnce();
    const url = new URL(String(f.openExternal.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://github.com/stefandsl/filow/issues/new");
    expect(url.href.length).toBeLessThanOrEqual(6000);
    const body = url.searchParams.get("body") || "";
    expect(body).toMatch(/my words[\s\S]*phone joined via <public link> with <key>/);
    expect(decodeURIComponent(url.href)).not.toMatch(/trycloudflare|sk-or-v1-0123/);
  });
  it("outside a QA build nothing can point the issue button at another page", async () => {
    const f = fixture({ FILOW_QA_ISSUE_PAGE: "http://127.0.0.1:9/elsewhere" });
    f.api.reportProblem();
    await f.ipc("report:issue", f.windows[0], "");
    expect(String(f.openExternal.mock.calls[0][0])).toMatch(/^https:\/\/github\.com\/stefandsl\/filow\/issues\/new\?/);
  });
  it("About carries the commit the build was made from, from sourceSha in package.json", async () => {
    const f = fixture({}); f.api.openAbout("about");
    const data: any = await f.ipc("about:data", f.windows[0]);
    expect(data.info.build).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(data.buildLabel).toContain("0123456");
    expect(data.buildLabel).not.toContain("01234567");
  });
  it("answers the report channels only for its own window", async () => {
    const f = fixture({}); f.api.reportProblem();
    await expect(f.ipc("report:data", { webContents: {} })).rejects.toThrow("Denied");
  });
  it("the menu and Settings open one About and privacy window, reused for the report", () => {
    const f = fixture({});
    f.api.openAbout("about"); f.api.reportProblem();
    expect(f.windows).toHaveLength(1);
    expect(f.windows[0].loaded).toEqual([[path.join("G:/fake", "about.html"), { hash: "about" }]]);
    expect(f.windows[0].webContents.send).toHaveBeenCalledWith("about:view", "report");
  });
});

// Easy settings: "Keep it on this PC" is only true if nothing reaches out at launch. The public link
// for a phone starts when the pairing panel opens. cloudflared is never run here: spawn is a stub.
describe("the phone link starts when pairing, not at launch", () => {
  /** A shell with cloudflared "installed" and a spawn that only records: no process, no network. */
  function shell(env: Record<string, string> = {}) {
    const execFileSync = vi.fn((cmd: string) => (cmd === "where" ? "G:/bin/cloudflared.exe\r\n" : ""));
    const spawn = vi.fn(() => { throw new Error("no tunnels in tests"); });
    const f = fixture(env, { childProcess: { execFile: vi.fn(), execFileSync, spawn } });
    const linkLines = () => f.appendFileSync.mock.calls.map((c: unknown[]) => String(c[1])).filter((l: string) => l.includes("public link:")).map((l: string) => l.replace(/^\S+ /, "").trim());
    return { f, spawn, linkLines, win: { reload: vi.fn() } };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("loading the shell starts nothing; opening the pairing panel starts the link once", async () => {
    const { f, spawn, linkLines, win } = shell();
    expect(f.api.settings().remoteShare).toBe(true);
    await settle();
    expect(spawn).not.toHaveBeenCalled();
    expect(linkLines()).toEqual([]);
    expect(f.api.linkForPairing(win)).toBe(true);
    await settle();
    // both tunnels were asked for (the page and the relay), with the fixed arguments; the stub refuses them
    expect(spawn.mock.calls.map((c: unknown[]) => [c[0], (c[1] as string[]).slice(0, 2)])).toEqual([["G:/bin/cloudflared.exe", ["tunnel", "--url"]], ["G:/bin/cloudflared.exe", ["tunnel", "--url"]]]);
    expect(linkLines()).toEqual(["public link: connecting", "public link: error no tunnels in tests"]);
    // started by opening the panel: no window reload, no dialog, and the user's choice stays on
    expect(win.reload).not.toHaveBeenCalled();
    expect(f.showMessageBox).not.toHaveBeenCalled();
    expect(f.api.settings().remoteShare).toBe(true);
  });

  it("a link that is up or coming up is not started again; a failed one is retried at the next opening", async () => {
    const { f, spawn, win } = shell();
    for (const state of ["on", "connecting", "downloading"]) {
      f.api.tunnels.state = state;
      expect(f.api.linkForPairing(win), state).toBe(false);
    }
    await settle();
    expect(spawn).not.toHaveBeenCalled();
    f.api.tunnels.state = "error";
    expect(f.api.linkForPairing(win)).toBe(true);
    await settle();
    expect(spawn).toHaveBeenCalledTimes(2); // one start: the page's tunnel and the relay's
  });

  it("never starts for a user who switched the link off, in offline mode, or with a hosted relay", async () => {
    const off = shell();
    off.f.api.patchSettings({ remoteShare: false });
    expect(off.f.api.linkForPairing(off.win)).toBe(false);
    const offline = shell({ FILOW_OFFLINE: "1" });
    offline.f.api.startupOffline();
    expect(offline.f.api.linkForPairing(offline.win)).toBe(false);
    const hosted = shell({ FILOW_SESSION_URL: "https://relay.example" });
    expect(hosted.f.api.linkForPairing(hosted.win)).toBe(false);
    await settle();
    for (const s of [off, offline, hosted]) { expect(s.spawn).not.toHaveBeenCalled(); expect(s.linkLines()).toEqual([]); }
  });

  it("the only automatic start is the pairing panel's: main.js wires it to the panel's message and the page sends it", () => {
    const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
    // one call site starts the link without the user's own switch, and it is linkForPairing
    expect(main.match(/setRemoteShare\([^)]*auto: true/g)).toHaveLength(1);
    const body = main.slice(main.indexOf("function linkForPairing(win) {"), main.indexOf("let remoteBusy"));
    expect(body.includes("void setRemoteShare(win, true, { auto: true, reload: false });")).toBe(true);
    expect(main.match(/linkForPairing\(/g)).toHaveLength(2); // its definition and the "remote:pairing" handler
    expect(/appOn\("remote:pairing", \(\) => \{\s*if \(mainWin && !mainWin\.isDestroyed\(\)\) linkForPairing\(mainWin\);/.test(main)).toBe(true);
    expect(readFileSync(new URL("./preload.js", import.meta.url), "utf8")).toContain('pairingOpened: () => ipcRenderer.send("remote:pairing")');
    const panel = readFileSync(new URL("../web/components/PairPanel.tsx", import.meta.url), "utf8");
    expect(/useEffect\(\(\) => \{\s*if \(open\) announcePairing\(bridge\);/.test(panel)).toBe(true);
  });
});
// Easy settings: the Windows installer no longer has a page of model names. A choices file left by an
// older installer is removed without being read, so the app's own first-run setup always decides.
describe("choices from an older installer", () => {
  it("are removed unread", () => {
    const f = fixture();
    f.fsReads.mockClear();
    f.api.dropInstallerChoices();
    expect(f.rmSync.mock.calls.map((c: unknown[]) => [String(c[0]).replace(/\\/g, "/").split("/").pop(), c[1]])).toEqual([["install-choices.json", { force: true }]]);
    expect(f.fsReads).not.toHaveBeenCalled();
  });
  it("a profile that cannot be written to does not stop the start", () => {
    const f = fixture();
    f.rmSync.mockImplementation(() => { throw new Error("EPERM"); });
    expect(() => f.api.dropInstallerChoices()).not.toThrow();
  });
});

// SIGN-04: an update never interrupts a live session.
describe("update ready during a take", () => {
  const withWindow = () => {
    const f = fixture(), toPage = vi.fn();
    f.api.setMainWin({ isDestroyed: () => false, show() {}, focus() {}, webContents: { send: toPage } });
    f.api.loadUpdater();
    return { ...f, toPage };
  };
  it("raises no dialog and no notification while a take is live", () => {
    const f = withWindow();
    f.api.setTakeLive(true);
    f.updaterHandlers["update-downloaded"]({ version: "9.9.9" });
    expect(f.showMessageBox, "a modal dialog would take the focus mid-talk").not.toHaveBeenCalled();
    expect(f.notificationShow, "a system notification would pop over the slides").not.toHaveBeenCalled();
    // the page still learns the update is ready: it shows its own banner once the take has ended
    expect(f.toPage).toHaveBeenCalledWith("update:status", expect.objectContaining({ status: "downloaded", version: "9.9.9" }));
    f.api.setTakeLive(false);
    expect(f.showMessageBox, "the skipped prompt is not replayed when the take ends").not.toHaveBeenCalled();
  });
  it("prompts as before when no take is running, also after one has ended", () => {
    const f = withWindow();
    f.api.setTakeLive(true); f.api.setTakeLive(false);
    f.updaterHandlers["update-downloaded"]({ version: "9.9.9" });
    expect(f.showMessageBox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ message: "Filow 9.9.9 is ready." }));
    expect(f.notificationShow).toHaveBeenCalledOnce();
  });
  it("takes only the boolean true as a live take, whatever a sender puts on the channel", () => {
    const f = withWindow();
    f.api.setTakeLive("yes");
    f.updaterHandlers["update-downloaded"]({ version: "9.9.9" });
    expect(f.showMessageBox).toHaveBeenCalledOnce();
  });
  it("stays silent while a PowerPoint slideshow runs", () => {
    const f = withWindow();
    f.api.setSlideShowRunning(true);
    f.updaterHandlers["update-downloaded"]({ version: "9.9.9" });
    expect(f.showMessageBox).not.toHaveBeenCalled();
    expect(f.notificationShow).not.toHaveBeenCalled();
  });
  it("ends the take when its page goes away, so the flag cannot silence prompts for good", () => {
    for (const leave of [
      (win: FakeWindow) => win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false }), // Settings from the menu
      (win: FakeWindow) => win.webContents.emit("render-process-gone", {}, { reason: "crashed" }),
      (win: FakeWindow) => win.emit("closed"),
    ]) {
      const f = withWindow(), win = fakeWindow();
      f.api.endTakeWithPage(win);
      f.api.setTakeLive(true);
      // a hash change or a frame inside the page is not the page going away
      win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
      win.webContents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
      f.updaterHandlers["update-downloaded"]({ version: "9.9.9" });
      expect(f.showMessageBox, "the take is still live").not.toHaveBeenCalled();
      leave(win);
      f.updaterHandlers["update-downloaded"]({ version: "9.9.9" });
      expect(f.showMessageBox, "the take ended with its page").toHaveBeenCalledOnce();
    }
  });
});

type FakeWindow = EventEmitter & { webContents: EventEmitter & { setWindowOpenHandler(fn: (details: { url: string }) => { action: string }): void; open?: (details: { url: string }) => { action: string } } };
function fakeWindow(): FakeWindow {
  const webContents = Object.assign(new EventEmitter(), {
    open: undefined as FakeWindow["webContents"]["open"],
    setWindowOpenHandler(fn: (details: { url: string }) => { action: string }) { webContents.open = fn; },
  });
  return Object.assign(new EventEmitter(), { webContents });
}

// SEC-04: will-navigate allowlist and window.open denied on every window.
describe("windows stay on Filow's own pages", () => {
  const guarded = () => {
    const f = fixture(), win = fakeWindow();
    f.api.guardNavigation(win);
    const navigate = (url: string) => { const event = { preventDefault: vi.fn() }; win.webContents.emit("will-navigate", event, url); return event.preventDefault.mock.calls.length > 0; };
    return { f, win, navigate, app: f.api.APP_URL as string };
  };
  it("lets a page move between Filow's own pages", () => {
    const { f, navigate, app } = guarded();
    expect(navigate(`${app}/settings/local`)).toBe(false);
    expect(navigate(`${app}/mirror?compact=1`)).toBe(false);
    expect(f.openExternal).not.toHaveBeenCalled();
  });
  it("refuses every other destination and hands web links to the system browser", () => {
    const { f, navigate, app } = guarded();
    expect(navigate("https://evil.test/")).toBe(true);
    expect(f.openExternal).toHaveBeenCalledExactlyOnceWith("https://evil.test/");
    for (const url of [`blob:${app}/3f1c`, "file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,x", "ms-msdt:/id", "not a url"]) {
      expect(navigate(url), url).toBe(true);
    }
    expect(f.openExternal, "only web and mail addresses leave the app").toHaveBeenCalledOnce();
    // look-alikes of the app address are other sites
    expect(navigate(app.replace("127.0.0.1", "127.0.0.1.evil.test"))).toBe(true);
    expect(navigate(app.replace(/:\d+$/, ":1"))).toBe(true);
    expect(navigate(app.replace("http:", "https:"))).toBe(true);
  });
  it("never lets a page open a window", () => {
    const { f, win, app } = guarded();
    for (const url of ["about:blank", "file:///C:/Windows/win.ini", `${app}/mirror`, "https://docs.example/"]) {
      expect(win.webContents.open?.({ url }), url).toEqual({ action: "deny" });
    }
    expect(f.openExternal.mock.calls.map(c => c[0])).toEqual([`${app}/mirror`, "https://docs.example/"]);
  });
  it("guards every window main.js creates", () => {
    // points-window.js holds the floating windows (overlay, points window) main.js opens
    const source = readFileSync(new URL("./main.js", import.meta.url), "utf8") + readFileSync(new URL("./points-window.js", import.meta.url), "utf8");
    const windows = source.match(/new (deps\.)?BrowserWindow\(/g)?.length ?? 0;
    const guards = (source.match(/^\s+(deps\.)?guardNavigation\(/gm)?.length ?? 0)
      // the welcome window refuses every navigation and every window by itself
      + (/"will-navigate", event => event\.preventDefault\(\)\);\s+win\.webContents\.setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\);/.test(source) ? 1 : 0);
    expect(windows).toBeGreaterThanOrEqual(5);
    expect(guards, "a new window needs guardNavigation(win)").toBe(windows);
  });
});

// I18N-01 for the shell: every menu, dialog and splash text is a key of the shared dictionary, so the
// core parity test covers it in every language. main.js keeps no table of its own, and every key it
// names exists (sharedText falls back to the bare key, which would show "menu.x" in the menu).
describe("desktop shell texts", () => {
  const source = readFileSync(new URL("./main.js", import.meta.url), "utf8");
  const en = DICTIONARIES.en as Record<string, string>;
  it("keeps no language table of its own", () => {
    expect(source.match(/^\s*(?:it|en|ru|ro|ja):\s*\{/gm) ?? [], "move the text into packages/core/src/i18n").toEqual([]);
  });
  it("names only keys the dictionary has", () => {
    const keys = [
      ...[...source.matchAll(/\bmt\("(\w+)"/g)].map(m => `menu.${m[1]}`),
      ...[...source.matchAll(/\bst\("(\w+)"/g)].map(m => `shell.splash.${m[1]}`),
      ...[...source.matchAll(/sharedText\("([\w.]+)"/g)].map(m => m[1]),
    ];
    expect(keys.length).toBeGreaterThan(40);
    expect([...new Set(keys)].filter(k => !(k in en))).toEqual([]);
  });
  it("asks about local AI in the user's language, with the machine filled in", () => {
    expect(t("shell.localAi.machine", "it", { ram: 16 })).toBe("Questo computer: 16 GB di RAM");
    expect(langFromLocale("it-IT")).toBe("it");
    expect(isLang("xx")).toBe(false);
  });
});

// Review of the five-language pass, finding 10: the key check above only sees literal keys in the
// source. Here the shell runs (menu, first-start questions, update prompts, splash) with a recording
// dictionary, so computed keys (mt(k), tx(key), `catalog.${n}`) are checked as they are asked for.
describe("desktop shell texts at run time", () => {
  const LANGS5 = Object.keys(DICTIONARIES) as (keyof typeof DICTIONARIES)[];
  const missing = (keys: Iterable<string>) => {
    const out: string[] = [];
    for (const key of keys) for (const lang of LANGS5) if (!((DICTIONARIES[lang] as Record<string, string>)[key] ?? "").trim()) out.push(`${lang} ${key}`);
    return out;
  };
  const fakeWin = () => ({ webContents: Object.assign(new EventEmitter(), { send: vi.fn() }), loadURL: vi.fn(), isDestroyed: () => false });
  const machine = (platform: string) => ({ ramGb: 32, gpu: "Fake GPU", freeGb: 200, platform, recommended: { profile: "advanced", models: ["clef", "gemma4:e4b"], ollama: true, downloadGb: 9.5 } });

  it("builds the menu on Windows, macOS and Linux only from keys every language has", () => {
    for (const platform of ["win32", "darwin", "linux"]) {
      const f = fixture({}, { platform });
      for (const lang of LANGS5) { f.api.setLang(lang); f.api.buildMenu(fakeWin()); }
      expect(f.asked.size, platform).toBeGreaterThan(20);
      expect(missing(f.asked), platform).toEqual([]);
    }
  });

  it("asks the first-start and update questions only from keys every language has", async () => {
    const f = fixture();
    f.api.setLocalAiHardware(machine("win32"));
    await f.api.offerLocalAi();
    f.api.patchSettings({ remoteShare: false });
    f.showMessageBox.mockResolvedValueOnce({ response: 1 }); // "Later": the rule is not written
    await f.api.offerFirewall(null);
    await f.api.checkForUpdates({ manual: true });
    for (const key of ["title", "local", "guard", "download", "starting"]) f.api.st(key);
    const asked = [...f.asked];
    for (const prefix of ["shell.localAi.", "shell.firewall.", "catalog.", "menu.", "shell.splash."]) expect(asked.some((k) => k.startsWith(prefix)), prefix).toBe(true);
    // st() is called with names this test made up: only the ones the dictionary has count as asked by the shell.
    const real = asked.filter((k) => !k.startsWith("shell.splash.") || k in DICTIONARIES.en);
    expect(missing(real)).toEqual([]);
  });

  it("names every model of the catalogue in every language", () => {
    const f = fixture();
    expect(f.catalog.length).toBeGreaterThan(5);
    expect(missing(f.catalog.map((n) => `catalog.${n}`))).toEqual([]);
  });

  it("names the machine in the user's language: ПК in Russian, Mac on a Mac", async () => {
    const message = async (lang: string, platform: string) => {
      const f = fixture({}, { platform });
      f.api.setLang(lang);
      f.api.setLocalAiHardware(machine(platform));
      await f.api.offerLocalAi();
      return (f.showMessageBox.mock.calls[0] as unknown[]).map((a) => (a as { message?: string } | null)?.message).find(Boolean);
    };
    expect(await message("ru", "win32")).toContain("на этом ПК без облака");
    expect(await message("ru", "darwin")).toContain("на этом Mac без облака");
    expect(await message("en", "win32")).toContain("on this PC without any cloud");
    expect(await message("it", "linux")).not.toContain("{device}");
  });
});
// I18N-02 for the shell: a dialog never carries a sentence written into the code, because that
// sentence stays English for an Italian user. Text comes from mt() or the shared dictionary.
describe("desktop shell dialogs", () => {
  it("answers a manual update check in the user's language", async () => {
    const f = fixture(); f.api.setLang("it");
    await f.api.checkForUpdates({ manual: true }); // the fake build has no update feed
    expect(f.showMessageBox).toHaveBeenCalledWith(null, expect.objectContaining({ message: "Gli aggiornamenti funzionano solo nell'app installata." }));
  });
  it("holds no hard-coded sentence in any dialog call", () => {
    const source = readFileSync(new URL("./main.js", import.meta.url), "utf8");
    // The startup failure box is left alone: it can fire before the settings (and so the language) are read.
    const allowed = new Set(["Filow failed to start"]);
    const sentences: string[] = [];
    for (const call of source.matchAll(/dialog\s*\.show(?:MessageBox|ErrorBox)\(/g)) {
      let depth = 1, end = call.index + call[0].length;
      while (depth > 0 && end < source.length) { const ch = source[end++]; if (ch === "(") depth++; else if (ch === ")") depth--; }
      const text = source.slice(call.index, end).replace(/\$\{[^}]*\}/g, "");
      for (const literal of text.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
        const value = literal[1] ?? literal[2];
        if (/\p{L}{2,} \p{L}{2,}/u.test(value) && !allowed.has(value)) sentences.push(`line ${source.slice(0, call.index).split("\n").length}: ${value.slice(0, 60)}`);
      }
    }
    expect(sentences, "move these texts into MENU_TEXT (en and it) and read them with mt()").toEqual([]);
  });
});

// Review T3 finding 7: reverting the first-run dialog changes failed no test. Finding 8: the welcome's
// speech-setup answer is kept on disk until offerLocalAi() uses it.
describe("first-run dialogs after the welcome", () => {
  it("the welcome answered the speech setup: offerLocalAi asks nothing and returns that answer", async () => {
    const f = fixture();
    Object.assign(f.api.welcomeSetup, { shown: true, choice: { models: ["clef-flash"], ollama: true } });
    expect(await f.api.offerLocalAi()).toEqual({ models: ["clef-flash"], ollama: true });
    expect(f.showMessageBox).not.toHaveBeenCalled();
  });
  it("an answer saved by a launch that quit before the server check is used, not asked again, then dropped", async () => {
    const f = fixture();
    f.api.patchSettings({ welcomeSetupAnswer: { choice: { models: ["gemma4:e4b"], ollama: true } } });
    expect(await f.api.offerLocalAi()).toEqual({ models: ["gemma4:e4b"], ollama: true });
    expect(f.showMessageBox).not.toHaveBeenCalled();
    expect(f.api.settings().welcomeSetupAnswer).toBeUndefined();
    const g = fixture();
    g.api.patchSettings({ welcomeSetupAnswer: { choice: null } });
    expect(await g.api.offerLocalAi()).toBeNull();
    expect(g.showMessageBox).not.toHaveBeenCalled();
  });
  it("with no answer anywhere, the native question is still asked", async () => {
    const f = fixture();
    await f.api.offerLocalAi(); // the fake machine (0 GB RAM) still gets the Lite recommendation
    expect(f.showMessageBox).toHaveBeenCalledOnce();
  });
  it("the public link is on: the firewall question is left to the pairing panel", async () => {
    const f = fixture();
    f.api.patchSettings({ remoteShare: true });
    await f.api.offerFirewall(null);
    expect(f.showMessageBox).not.toHaveBeenCalled();
  });
  it("the public link is off and the rule is missing: the firewall question is asked", async () => {
    const f = fixture();
    f.api.patchSettings({ remoteShare: false });
    f.showMessageBox.mockResolvedValueOnce({ response: 1 });
    await f.api.offerFirewall(null);
    expect(f.showMessageBox).toHaveBeenCalledOnce();
  });
});

// Review T3 findings 2, 3, 8 on the main-process side of the welcome (the IPC handlers call these).
describe("welcome setup step, main process", () => {
  const tick = () => new Promise((r) => setTimeout(r, 20));
  it("no hardware scan answer before the window is shown; welcome:ready shows it and lets the scan run", async () => {
    const f = fixture();
    const show = vi.fn();
    f.api.setWelcomeWin({ show });
    let offer: unknown = null;
    void f.api.welcomeOfferForStep().then((o: unknown) => { offer = o; });
    await tick();
    expect(offer).toBeNull();
    f.api.onWelcomeReady();
    expect(show).toHaveBeenCalledOnce();
    for (let i = 0; i < 50 && !offer; i++) await tick();
    expect(offer).toMatchObject({ ask: true, device: "pc" });
  });
  it("the answer is written to settings.json at once (survives a quit before the server check)", async () => {
    const f = fixture();
    f.api.setWelcomeWin({ show() {} });
    f.api.onWelcomeReady();
    await f.api.welcomeOfferForStep();
    f.api.chooseWelcomeSetup(false);
    expect(f.api.settings().welcomeSetupAnswer).toEqual({ choice: null });
    const written = f.writeFileSync.mock.calls.map((c: unknown[]) => String(c[1])).join("\n");
    expect(written).toContain("welcomeSetupAnswer");
  });
  it("accepting when no offer was shown (the scan failed, the card said 'set up from Settings') downloads nothing", () => {
    const f = fixture();
    f.api.chooseWelcomeSetup(true);
    expect(f.api.welcomeSetup.choice).toBeNull();
    expect(f.api.welcomeSetup.shown).toBe(true);
  });
  it("accepting the offer the step showed returns what to install", async () => {
    const f = fixture();
    f.api.setWelcomeWin({ show() {} });
    f.api.onWelcomeReady();
    await f.api.welcomeOfferForStep();
    f.api.chooseWelcomeSetup(true);
    expect(f.api.welcomeSetup.choice?.models?.length).toBeGreaterThan(0);
  });
});

// A window is filled with its backgroundColor until its page is painted (and while it reloads). When
// that colour is not the page's own --bg, the page arrives with a change of shade: the splash and
// the overlay were #08090b / #f7f7f5 under pages that are #121212 / #f6f7f9.
describe("window background colours", () => {
  it("are the page background of the theme tokens, in every window and both themes", () => {
    const source = readFileSync(new URL("./main.js", import.meta.url), "utf8");
    const tokens = readFileSync(new URL("../web/app/theme-tokens.css", import.meta.url), "utf8");
    const bg = (css: string) => /--bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1].toLowerCase();
    const want = { dark: bg(tokens), light: bg(tokens.slice(tokens.indexOf(':root[data-theme="light"]'))) };
    expect(want.dark && want.light && want.dark !== want.light, "theme-tokens.css gives --bg for both themes").toBe(true);
    // The region picker is black on purpose: it shows a frozen picture of the screen, not a page.
    // Floating windows (points-window.js) take theirs as `background` (a value or a function) from main.js.
    const all = [...source.matchAll(/\bbackground(?:Color)?:\s*(?:\(\)\s*=>\s*)?([^,\n]+)/g)].map((m) => m[1].trim()).filter((value) => value !== '"#000000"');
    const themed = all.map((value) => /^uiTheme\(\) === "dark" \? "(#[0-9a-f]{6})" : "(#[0-9a-f]{6})"$/i.exec(value));
    expect(all.filter((_, i) => !themed[i]), "every window background in main.js picks its colour with uiTheme()").toEqual([]);
    expect(themed.length).toBeGreaterThanOrEqual(5); // settings, splash, overlay, points window, main window
    const floating = readFileSync(new URL("./points-window.js", import.meta.url), "utf8");
    expect(floating.match(/#[0-9a-f]{6}\b/gi) ?? [], "points-window.js takes its colours from main.js").toEqual([]);
    for (const m of themed) expect({ dark: m![1].toLowerCase(), light: m![2].toLowerCase() }).toEqual(want);
  });
});

// A second launch on the same profile used to start its own servers, crash on EADDRINUSE and leave the
// running window where it was (packaged build, 2026-11-10). Now it starts nothing and the running Filow
// comes forward. The lock is keyed on userData, so FILOW_USER_DATA_DIR profiles keep running side by side.
describe("single instance per profile", () => {
  const fakeWindow = (state: { visible?: boolean; minimized?: boolean } = {}) => {
    const w = { visible: state.visible ?? true, minimized: state.minimized ?? false, focused: false,
      isDestroyed: () => false, isVisible: () => w.visible, isMinimized: () => w.minimized,
      restore: vi.fn(() => { w.minimized = false; }), show: vi.fn(() => { w.visible = true; }), focus: vi.fn(() => { w.focused = true; }) };
    return w;
  };
  it("a second launch on a profile already in use starts nothing and leaves", () => {
    const f = fixture({}, { lockHeld: true });
    expect(f.appExit).toHaveBeenCalledWith(0);
    expect(f.whenReady, "main() must not start: no servers, no splash, no ports").not.toHaveBeenCalled();
  });
  it("the first launch starts as before", () => {
    const f = fixture();
    expect(f.appExit).not.toHaveBeenCalled();
    expect(f.whenReady).toHaveBeenCalledOnce();
  });
  it("the lock is claimed after the test profile is applied, so other profiles run side by side", () => {
    const f = fixture({ FILOW_USER_DATA_DIR: "G:/FILOW/tmp/probe-profile" });
    expect(f.calls.indexOf("setPath userData G:/FILOW/tmp/probe-profile")).toBeGreaterThanOrEqual(0);
    expect(f.calls.indexOf("lock")).toBeGreaterThan(f.calls.indexOf("setPath userData G:/FILOW/tmp/probe-profile"));
  });
  it("brings the running main window forward, restoring it when minimized", () => {
    const f = fixture(); const win = fakeWindow({ minimized: true });
    f.api.setMainWin(win);
    f.appHandlers["second-instance"]({}, ["Filow.exe"], "G:/");
    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focused).toBe(true);
  });
  it("brings the welcome forward while it is open", () => {
    const f = fixture(); const main = fakeWindow({ visible: false }), welcome = fakeWindow();
    f.api.setMainWin(main); f.api.setWelcomeWin(welcome);
    f.appHandlers["second-instance"]({}, ["Filow.exe"], "G:/");
    expect(welcome.focused).toBe(true);
    expect(main.show, "the main window is not shown over the welcome").not.toHaveBeenCalled();
  });
});

describe("test isolation: FILOW_QA_NO_GLOBAL_INPUT=1 (global-input.js)", () => {
  it("registers no global shortcut, refuses the microphone, never writes the clipboard and gives Chromium its fake device", () => {
    const f = fixture({ FILOW_QA_NO_GLOBAL_INPUT: "1" }, { qaBuild: true });
    expect(f.processExit).not.toHaveBeenCalled();
    f.api.patchSettings({ screenSense: true, screenHotkey: "Control+Alt+S" });
    f.api.registerHotkey();
    expect(f.registerShortcut).not.toHaveBeenCalled();
    expect(f.api.permissionFor("media")).toBe(false);
    expect(f.api.permissionFor("display-capture")).toBe(true);
    f.api.copyText("from the test instance");
    expect(f.writeText).not.toHaveBeenCalled();
    expect(f.calls).toContain("switch use-fake-device-for-media-stream");
  });
  it("control: without the switch the same calls reach Electron", () => {
    const f = fixture();
    f.api.patchSettings({ screenSense: true, screenHotkey: "Control+Alt+S" });
    expect(f.api.registerHotkey()).toEqual({ ok: true });
    expect(f.registerShortcut).toHaveBeenCalledOnce();
    expect(f.api.permissionFor("media")).toBe(true);
    f.api.copyText("from the user");
    expect(f.writeText).toHaveBeenCalledWith("from the user");
    expect(f.calls.filter((c: string) => c.startsWith("switch "))).toEqual([]);
    expect(f.processExit).not.toHaveBeenCalled();
  });
  // STANDARDS SEC-13: a released build has no test mode. Started with the switch it cannot run isolated,
  // so it leaves before it touches a profile, the instance lock, a Chromium switch or a window.
  it("a released build started with the switch leaves at once, before the profile, the lock and any window", () => {
    const f = fixture({ FILOW_QA_NO_GLOBAL_INPUT: "1", FILOW_USER_DATA_DIR: "G:/fake/profile" });
    expect(f.processExit).toHaveBeenCalledWith(1);
    expect(f.calls[0]).toBe("process.exit 1");
    // what the stand-in exit lets run afterwards is a normal Filow, never a half isolated one
    expect(f.calls).not.toContain("switch use-fake-device-for-media-stream");
  });
  it("the fake microphone and the socket log stay off in a released build, and work in a QA build", () => {
    const f = fixture({ FILOW_OKF_FAKE_MIC: "G:/fake/take.wav" });
    expect(f.calls.filter((c: string) => c.startsWith("switch "))).toEqual([]);
    const qa = fixture({ FILOW_OKF_FAKE_MIC: "G:/fake/take.wav" }, { qaBuild: true });
    expect(qa.calls).toContain("switch use-file-for-fake-audio-capture G:/fake/take.wav");
  });
});
