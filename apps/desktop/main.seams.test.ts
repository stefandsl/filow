import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { PLACEHOLDER, t } from "@filow/core";
// localai.js reads the setup rules and the card detection from vendor/, a build of these two files
// (npm run build:welcome); vendor/ is not in git, so the fixture hands it the sources themselves.
import * as profileRules from "../../packages/core/src/profile";
import * as hardwareRules from "../../packages/core/src/hardware";

/** Evaluate untouched main.js, with startup held and all effects replaced in-process. */
function fixture(initialEnv: Record<string, string> = {}, { updateFeed = false, childProcess = {} as Record<string, unknown>, lockHeld = false } = {}) {
  const env = { ...initialEnv };
  // single instance: the order of profile and lock calls, the app's event handlers, exit and start
  const calls: string[] = [], appHandlers: Record<string, (...args: any[]) => void> = {};
  const appExit = vi.fn(), whenReady = vi.fn(() => ({ then() {} }));
  let requestFilter!: (details: { url: string }, cb: (r: unknown) => void) => void;
  const outbound = vi.fn(() => { throw new Error("fake network boundary: no bytes sent"); });
  const openExternal = vi.fn(async () => {}), checkForUpdates = vi.fn(async () => null);
  const writeText = vi.fn(), showMessageBox = vi.fn(async () => ({ response: 0 }));
  const updaterHandlers: Record<string, (info: { version: string }) => void> = {}, notificationShow = vi.fn();
  const writeFileSync = vi.fn();
  const modules: Record<string, any> = {
    electron: {
      crashReporter: { start() {} },
      app: { isPackaged: true, getPath: () => "G:/fake", setPath: (name: string, value: string) => { calls.push(`setPath ${name} ${value}`); },
        on: (event: string, fn: (...args: any[]) => void) => { appHandlers[event] = fn; }, setAppUserModelId() {},
        requestSingleInstanceLock: () => { calls.push("lock"); return !lockHeld; }, exit: appExit,
        whenReady, getLocale: () => "en", getVersion: () => "test", getGPUInfo: async () => ({}) },
      ipcMain: { on() {} }, BrowserWindow: { getAllWindows: () => [] },
      session: { defaultSession: { webRequest: { onBeforeRequest: (_filter: unknown, cb: typeof requestFilter) => { requestFilter = cb; } } } },
      shell: { openExternal }, dialog: { showMessageBox }, clipboard: { writeText },
      Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu() {} },
      Notification: class { static isSupported() { return true; } on() {} show() { notificationShow(); } },
      net: { isOnline: () => true },
    },
    "node:path": path, "node:url": { pathToFileURL },
    "node:fs": { readFileSync: () => "FILOW_OFFLINE=1", appendFileSync() {}, existsSync: (file: string) => updateFeed && String(file).endsWith("app-update.yml"), mkdirSync() {}, rmSync() {}, writeFileSync, renameSync() {} },
    "node:os": { homedir: () => "G:/fake", cpus: () => [{ model: "fake" }], totalmem: () => 0, release: () => "fake", networkInterfaces: () => ({}) },
    "node:http": { get: () => { const req = new EventEmitter(); queueMicrotask(() => req.emit("error", new Error("Ollama absent"))); return req; } },
    "node:https": { get: outbound }, "node:crypto": {}, "node:net": {}, "node:child_process": childProcess,
    "node:worker_threads": {}, "node:events": EventEmitter,
    "./stt-download": { idleTimeout: () => ({ stop() {} }), retryDownload: (operation: () => unknown) => operation() },
    "./vendor/i18n": { t }, "./vendor/profile": profileRules, "./vendor/hardware": hardwareRules, "./ui-preferences": {}, "./slideshow": {},
  };
  // Real downloader orchestration, absent installation/model, fake disk and network.
  for (const name of ["stt", "localai", "diag", "welcome-setup", "single-instance"]) {
    const module = { exports: {} };
    runInNewContext(readFileSync(new URL(`./${name}.js`, import.meta.url), "utf8"), {
      require: (id: string) => { if (!(id in modules)) throw new Error(`unexpected dependency: ${id}`); return modules[id]; },
      module, process: { env, platform: "win32" }, URL, setTimeout,
    });
    modules[`./${name}`] = module.exports;
  }
  const api = runInNewContext(readFileSync(new URL("./main.js", import.meta.url), "utf8") + `
    ;({ applyOffline, loadEnv, aliasLegacyEnv, sttDownload, sttStatus, startOllamaInstall, localAiStatus: () => localAiState, reportProblem, checkForUpdates,
       startupOffline: () => applyOffline(null), tunnels, stopTunnels, setLog: text => { lastTakeLog = text; },
       textTables: { MENU_TEXT, NET_TEXT, SPLASH_TEXT, LOCAL_AI_TEXT },
       setTakeLive, loadUpdater, setMainWin: win => { mainWin = win; }, setLang: lang => { settings.lang = lang; },
       guardNavigation, endTakeWithPage, APP_URL, setSlideShowRunning: running => { slideShow = { ...slideShow, running }; },
       offerLocalAi, offerFirewall, welcomeSetup, settings: () => settings, patchSettings: patch => Object.assign(settings, patch),
       onWelcomeReady, welcomeOfferForStep, chooseWelcomeSetup, setWelcomeWin: win => { welcomeWin = win; } });`, {
    require: (id: string) => {
      if (id.endsWith("electron-updater.js")) return { autoUpdater: { on(event: string, fn: (info: { version: string }) => void) { updaterHandlers[event] = fn; }, checkForUpdates, quitAndInstall() {} } };
      if (!(id in modules)) throw new Error(`unexpected dependency: ${id}`);
      return modules[id];
    },
    __dirname: "G:/fake", process: { env, platform: "win32", arch: "x64", resourcesPath: "G:/fake", versions: {}, on() {} },
    URL, URLSearchParams, console, setTimeout, clearTimeout,
  });
  return { api, env, outbound, openExternal, checkForUpdates, writeText, showMessageBox, updaterHandlers, notificationShow, writeFileSync,
    calls, appHandlers, appExit, whenReady,
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
  // Contract: main.js offline menu: "no outbound requests"; Q4 text egress includes diagnostics.
  it("offline report must not place take log text in an external browser URL", async () => {
    const f = fixture({ FILOW_OFFLINE: "1" }); f.api.setLog("synthetic private take log");
    await f.api.reportProblem(null);
    expect(f.openExternal, "offline report must not hand private log text to an external URL").not.toHaveBeenCalled();
    expect(f.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      message: t("offline.reportCopyPrompt", "en"), buttons: [t("offline.copyReport", "en"), t("common.cancel", "en")],
    }));
    expect(f.writeText).toHaveBeenCalledWith(expect.stringContaining("synthetic private take log"));
  });
  it("online report masks a live public link and keys before they reach the public issue URL", async () => {
    const f = fixture({});
    // the key is built from pieces so no key-shaped string sits in a tracked file (SUP-05 scans them)
    f.api.setLog("phone joined via https://drives-pulling-agrees-ambassador.trycloudflare.com/s/1 with sk-or-v1-" + "0123456789abcdef".repeat(2));
    await f.api.reportProblem(null);
    expect(f.openExternal).toHaveBeenCalledTimes(1);
    const body = decodeURIComponent(String(f.openExternal.mock.calls[0][0]).split("&body=")[1]);
    expect(body).toContain("phone joined via <public link> with <key>");
    expect(body).not.toMatch(/trycloudflare|sk-or-v1-0123/);
  });
  it("offline report cancellation leaves the clipboard unchanged", async () => {
    const f = fixture({ FILOW_OFFLINE: "1" }); f.showMessageBox.mockResolvedValue({ response: 1 });
    await f.api.reportProblem(null);
    expect(f.writeText).not.toHaveBeenCalled();
    expect(f.openExternal).not.toHaveBeenCalled();
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
    const source = readFileSync(new URL("./main.js", import.meta.url), "utf8");
    const windows = source.match(/new BrowserWindow\(/g)?.length ?? 0;
    const guards = (source.match(/^\s+guardNavigation\(/gm)?.length ?? 0)
      // the welcome window refuses every navigation and every window by itself
      + (/"will-navigate", event => event\.preventDefault\(\)\);\s+win\.webContents\.setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\);/.test(source) ? 1 : 0);
    expect(windows).toBeGreaterThanOrEqual(5);
    expect(guards, "a new window needs guardNavigation(win)").toBe(windows);
  });
});

// I18N-01 for the shell: main.js keeps its own en/it tables (menu, firewall prompt, splash, local AI)
// outside the core dictionaries, so the core parity test does not see them. mt() falls back to
// English only when a key is absent, so an empty string would show a blank label.
describe("desktop shell text tables", () => {
  type Entry = string | ((hw: object, rec: object) => string);
  const tables = fixture().api.textTables as Record<string, Record<"en" | "it", Record<string, Entry>>>;
  const placeholders = (text: string) => [...text.matchAll(PLACEHOLDER)].map(m => m[1]).sort();
  // LOCAL_AI_TEXT builds two of its texts from the hardware scan: render those with a sample machine.
  const hw = { platform: "win32", ramGb: 16, gpu: "sample GPU", freeGb: 100 };
  const rec = { downloadGb: 5, labels: ["sample model"], ollama: true };
  const text = (entry: Entry) => (typeof entry === "function" ? entry(hw, rec) : entry);
  it.each(Object.keys(tables))("%s: Italian has the same keys, placeholders and no empty text", name => {
    const { en, it: italian } = tables[name];
    expect(Object.keys(italian).sort(), `${name}: keys differ between en and it`).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(typeof italian[key], `${name}.${key}: en and it are different kinds of entry`).toBe(typeof en[key]);
      expect(text(en[key]).trim(), `${name}.en.${key} is empty`).not.toBe("");
      expect(text(italian[key]).trim(), `${name}.it.${key} is empty`).not.toBe("");
      expect(placeholders(text(italian[key])), `${name}.${key}: placeholders differ (en "${text(en[key])}", it "${text(italian[key])}")`).toEqual(placeholders(text(en[key])));
    }
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
