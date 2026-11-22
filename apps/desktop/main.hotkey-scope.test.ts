import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { isLang, langFromLocale, t } from "@filow/core";
// localai.js reads the setup rules and the card detection from vendor/, a build of these two files
// (npm run build:welcome); vendor/ is not in git, so the fixture hands it the sources themselves.
import * as profileRules from "../../packages/core/src/profile";
import * as hardwareRules from "../../packages/core/src/hardware";

/** Evaluate untouched main.js, with startup held and all effects replaced in-process. */
function fixture(initialEnv: Record<string, string> = {}, { updateFeed = false, childProcess = {} as Record<string, unknown>, lockHeld = false, platform = "win32", qaBuild = false, updates = undefined as boolean | undefined } = {}) {
  // every dictionary key the shell asks for while it runs, literal or computed (mt(k), tx(key), `catalog.${n}`)
  const asked = new Set<string>();
  const recordingT = (key: string, lang: string, vars?: Record<string, string | number>) => { asked.add(key); return t(key, lang as Parameters<typeof t>[1], vars); };
  const env = { ...initialEnv };
  // single instance: the order of profile and lock calls, the app's event handlers, exit and start
  const calls: string[] = [], appHandlers: Record<string, (...args: any[]) => void> = {};
  const appExit = vi.fn(), whenReady = vi.fn(() => ({ then() {} })), processExit = vi.fn((code: number) => { calls.push(`process.exit ${code}`); });
  // windows main.js (and about.js) create, and the ipcMain.handle channels they register
  const windows: any[] = [], ipcHandlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {};
  const ipcListeners: Record<string, (event: unknown, ...args: unknown[]) => void> = {};
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
  const menu = vi.fn();
  const quitAndInstall = vi.fn(), updaterLoad = vi.fn();
  const openExternal = vi.fn(async () => {}), checkForUpdates = vi.fn(async () => null);
  const registerShortcut = vi.fn(() => true);
  const writeText = vi.fn(), showMessageBox = vi.fn(async () => ({ response: 0 }));
  const updaterHandlers: Record<string, (info: { version: string }) => void> = {}, notificationShow = vi.fn();
  const writeFileSync = vi.fn(), appendFileSync = vi.fn(), rmSync = vi.fn(), fsRead = vi.fn((..._args: unknown[]) => "FILOW_OFFLINE=1");
  // Electron's globalShortcut is one process-wide table: a stateful stand-in with the same semantics.
  const table = new Map<string, () => void>();
  const shortcuts = {
    register: (acc: string, fn: () => void) => { registerShortcut(); if (table.has(acc)) return false; table.set(acc, fn); return true; },
    isRegistered: (acc: string) => table.has(acc),
    unregister: (acc: string) => { table.delete(acc); },
    unregisterAll: () => { table.clear(); },
  };
  const modules: Record<string, any> = {
    electron: {
      crashReporter: { start() {} },
      app: { isPackaged: true, getPath: () => "G:/fake", setPath: (name: string, value: string) => { calls.push(`setPath ${name} ${value}`); },
        on: (event: string, fn: (...args: any[]) => void) => { appHandlers[event] = fn; }, setAppUserModelId() {},
        requestSingleInstanceLock: () => { calls.push("lock"); return !lockHeld; }, exit: appExit,
        whenReady, getLocale: () => "en", getVersion: () => "test", getGPUInfo: async () => ({}), commandLine: { appendSwitch: (...a: string[]) => { calls.push(`switch ${a.join(" ")}`); } } },
      ipcMain: { on: (channel: string, fn: (event: unknown, ...args: unknown[]) => void) => { ipcListeners[channel] = fn; }, handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => { ipcHandlers[channel] = fn; } }, BrowserWindow: FakeBrowserWindow,
      session: { defaultSession: { webRequest: { onBeforeRequest: (_filter: unknown, cb: typeof requestFilter) => { requestFilter = cb; } } } },
      shell: { openExternal }, dialog: { showMessageBox }, clipboard: { writeText }, globalShortcut: shortcuts,
      Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: menu },
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
    "./vendor/i18n": { t: recordingT, isLang, langFromLocale }, "./vendor/profile": profileRules, "./vendor/hardware": hardwareRules, "./slideshow": {},
    // the real sender rule, so the window buttons are checked as in the app
    "./ui-preferences": { trustedUiSender: createRequire(import.meta.url)("./ui-preferences.js").trustedUiSender },
    "./window-controls": createRequire(import.meta.url)("./window-controls.js"),
    "./ollama-runtime": createRequire(import.meta.url)("./ollama-runtime.js"),
    "./local-ownership": { ownership: () => ({ beginRuntime() {}, completeRuntime() {} }) },
    "./package.json": { updates, sourceSha: "0123456789abcdef0123456789abcdef01234567" }, // what CI writes into the packed package.json
    "./qa.js": { isQaBuild: (app: { isPackaged: boolean }) => qaBuild || !app.isPackaged }, // a packaged build, without the QA marker unless qaBuild
    "./points-window": { createFloatingWindow() {}, createPointsWindow: () => ({ isOpen: () => false, owns: () => false, webContents: () => null, reload() {}, set() {}, hide() {}, show() {} }) },
  };
  // Real downloader orchestration, absent installation/model, fake disk and network.
  for (const name of ["global-input", "qa-headless", "model-files", "download", "model-roles", "stt", "localai", "diag", "s1-runtime", "welcome-setup", "single-instance", "about", "proxy-guard"]) {
    const module = { exports: {} };
    runInNewContext(readFileSync(new URL(`./${name}.js`, import.meta.url), "utf8"), {
      require: (id: string) => { if (!(id in modules)) throw new Error(`unexpected dependency: ${id}`); return modules[id]; },
      module, process: { env, platform }, URL, setTimeout, clearTimeout, AbortController, __dirname: "G:/fake",
    });
    modules[`./${name}`] = module.exports;
  }
  // the pure tunnel rules, as main.js asks for them
  modules["./tunnels.js"] = createRequire(import.meta.url)("./tunnels.js");
  // the shared updater policy and install recheck guard
  modules["./updater-policy.js"] = createRequire(import.meta.url)("./updater-policy.js");
  // the old seeded model ids loadEnv reads as unset
  modules["./env-defaults.js"] = createRequire(import.meta.url)("./env-defaults.js");
  const api = runInNewContext(readFileSync(new URL("./main.js", import.meta.url), "utf8") + `
    ;({ applyOffline, loadEnv, aliasLegacyEnv, sttDownload, sttStatus, startOllamaInstall, localAiStatus: () => localAiState, reportProblem, openAbout: view => about().open(view), checkForUpdates,
       startupOffline: () => applyOffline(null), tunnels, stopTunnels, setRemoteShare, linkForPairing, dropInstallerChoices, setLog: text => { lastTakeLog = text; },
       setTakeLive, loadUpdater, installUpdate, setUpdateState, setMainWin: win => { mainWin = win; }, setLang: lang => { settings.lang = lang; },
       guardNavigation, endTakeWithPage, APP_URL, setSlideShowRunning: running => { slideShow = { ...slideShow, running }; },
       offerLocalAi, offerFirewall, welcomeSetup, registerHotkey, permissionFor, copyText: text => clipboard.writeText(text), settings: () => settings, patchSettings: patch => Object.assign(settings, patch),
       onWelcomeReady, welcomeOfferForStep, chooseWelcomeSetup, setWelcomeWin: win => { welcomeWin = win; }, buildMenu, st,
       setLocalAiHardware: hw => { localAiHardware = Promise.resolve(hw); } });`, {
    require: (id: string) => {
      if (id.endsWith("electron-updater.js")) { updaterLoad(); return { autoUpdater: { on(event: string, fn: (info: { version: string }) => void) { updaterHandlers[event] = fn; }, checkForUpdates, quitAndInstall } }; }
      if (!(id in modules)) throw new Error(`unexpected dependency: ${id}`);
      return modules[id];
    },
    __dirname: "G:/fake", process: { env, platform, arch: "x64", resourcesPath: "G:/fake", versions: {}, on() {}, exit: processExit },
    URL, URLSearchParams, console, setTimeout, clearTimeout, setInterval: () => ({ unref() {} }), clearInterval, AbortController,
  });
  return { api, shortcuts, table, env, menu, quitAndInstall, updaterLoad, registerShortcut, outbound, openExternal, checkForUpdates, writeText, showMessageBox, updaterHandlers, notificationShow, writeFileSync, appendFileSync, rmSync, fsReads: fsRead,
    calls, appHandlers, appExit, processExit, whenReady, windows, asked, catalog: Object.keys(modules["./localai"].CATALOG),
    ipc: async (channel: string, win: { webContents: unknown }, ...args: unknown[]) => ipcHandlers[channel]({ sender: win.webContents }, ...args),
    ipcHandlers, ipcListeners,
    blocked: (url: string) => { let result: any; requestFilter({ url }, r => { result = r; }); return result.cancel === true; } };
}

// Contract: okfilow.js:820 bindPillKeys registers the eye/pause keys once (okfilow-stop.js:292 bindKey) and reports
// them "ok"; they are registered again only when the choice changes. main.js:2490 starts OK Filow, then main.js:2537
// calls registerHotkey for Screen Sense, and screen:setSettings (main.js:621) calls it again on every save.
const { bindKey } = createRequire(import.meta.url)("./okfilow-stop.js");

describe("Screen Sense hotkey vs OK Filow's shortcuts (one process-wide globalShortcut)", () => {
  it("registerHotkey at launch leaves OK Filow's eye and pause keys registered", () => {
    const f = fixture();
    // what okfilow.js bindPillKeys does in okFilow.start() (main.js:2490), with the defaults EYE_KEYS[0]/PAUSE_KEYS[0]
    const eye = bindKey(f.shortcuts, null, "ctrl+alt+shift+h", () => {});
    const pause = bindKey(f.shortcuts, null, "ctrl+alt+shift+g", () => {});
    expect([eye.state, pause.state]).toEqual(["ok", "ok"]);
    f.api.patchSettings({ screenSense: true, screenHotkey: "Control+Alt+S" });
    expect(f.api.registerHotkey()).toEqual({ ok: true }); // main.js:2537
    expect(f.table.has("Control+Alt+S")).toBe(true);
    expect(f.table.has(eye.accelerator), "OK Filow's eye key (still reported ok) must stay registered").toBe(true);
    expect(f.table.has(pause.accelerator), "OK Filow's pause key (still reported ok) must stay registered").toBe(true);
  });
  it("saving Screen Sense settings leaves OK Filow's keys registered and swaps only its own hotkey", async () => {
    const f = fixture();
    const eye = bindKey(f.shortcuts, null, "ctrl+alt+shift+h", () => {});
    f.api.patchSettings({ screenSense: true, screenHotkey: "Control+Alt+S" });
    f.api.registerHotkey();
    f.api.patchSettings({ screenHotkey: "Control+Alt+K" });
    expect(f.api.registerHotkey()).toEqual({ ok: true });
    expect(f.table.has("Control+Alt+K")).toBe(true);
    expect(f.table.has("Control+Alt+S"), "the old Screen Sense key is let go").toBe(false);
    expect(f.table.has(eye.accelerator), "OK Filow's eye key must survive a Screen Sense save").toBe(true);
  });
});
