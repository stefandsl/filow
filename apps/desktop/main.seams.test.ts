import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { t } from "@filow/core";

/** Evaluate untouched main.js, with startup held and all effects replaced in-process. */
function fixture(initialEnv: Record<string, string> = {}) {
  const env = { ...initialEnv };
  let requestFilter!: (details: { url: string }, cb: (r: unknown) => void) => void;
  const outbound = vi.fn(() => { throw new Error("fake network boundary: no bytes sent"); });
  const openExternal = vi.fn(async () => {}), checkForUpdates = vi.fn(async () => null);
  const writeText = vi.fn(), showMessageBox = vi.fn(async () => ({ response: 0 }));
  const modules: Record<string, any> = {
    electron: {
      crashReporter: { start() {} },
      app: { isPackaged: true, getPath: () => "G:/fake", setPath() {}, on() {}, setAppUserModelId() {},
        whenReady: () => ({ then() {} }), getLocale: () => "en", getVersion: () => "test", getGPUInfo: async () => ({}) },
      ipcMain: { on() {} }, BrowserWindow: { getAllWindows: () => [] },
      session: { defaultSession: { webRequest: { onBeforeRequest: (_filter: unknown, cb: typeof requestFilter) => { requestFilter = cb; } } } },
      shell: { openExternal }, dialog: { showMessageBox }, clipboard: { writeText },
    },
    "node:path": path, "node:url": { pathToFileURL },
    "node:fs": { readFileSync: () => "FILOW_OFFLINE=1", appendFileSync() {}, existsSync: () => false, mkdirSync() {}, rmSync() {} },
    "node:os": { homedir: () => "G:/fake", cpus: () => [{ model: "fake" }], totalmem: () => 0, release: () => "fake" },
    "node:http": { get: () => { const req = new EventEmitter(); queueMicrotask(() => req.emit("error", new Error("Ollama absent"))); return req; } },
    "node:https": { get: outbound }, "node:crypto": {}, "node:net": {}, "node:child_process": {},
    "node:worker_threads": {}, "node:events": EventEmitter,
    "./stt-download": { idleTimeout: () => ({ stop() {} }), retryDownload: (operation: () => unknown) => operation() },
    "./vendor/i18n": { t }, "./ui-preferences": {}, "./welcome-setup": {}, "./slideshow": {},
  };
  // Real downloader orchestration, absent installation/model, fake disk and network.
  for (const name of ["stt", "localai", "diag"]) {
    const module = { exports: {} };
    runInNewContext(readFileSync(new URL(`./${name}.js`, import.meta.url), "utf8"), {
      require: (id: string) => { if (!(id in modules)) throw new Error(`unexpected dependency: ${id}`); return modules[id]; },
      module, process: { env, platform: "win32" }, URL,
    });
    modules[`./${name}`] = module.exports;
  }
  const api = runInNewContext(readFileSync(new URL("./main.js", import.meta.url), "utf8") + `
    ;({ applyOffline, loadEnv, aliasLegacyEnv, sttDownload, sttStatus, startOllamaInstall, localAiStatus: () => localAiState, reportProblem, checkForUpdates,
       startupOffline: () => applyOffline(null), tunnels, setLog: text => { lastTakeLog = text; } });`, {
    require: (id: string) => {
      if (id.endsWith("electron-updater.js")) return { autoUpdater: { on() {}, checkForUpdates } };
      if (!(id in modules)) throw new Error(`unexpected dependency: ${id}`);
      return modules[id];
    },
    __dirname: "G:/fake", process: { env, platform: "win32", arch: "x64", resourcesPath: "G:/fake", versions: {}, on() {} },
    URL, URLSearchParams, console,
  });
  return { api, env, outbound, openExternal, checkForUpdates, writeText, showMessageBox,
    blocked: (url: string) => { let result: any; requestFilter({ url }, r => { result = r; }); return result.cancel === true; } };
}

describe("Step 4 desktop offline seams", () => {
  it("process-level offline blocks new renderer cloud requests and update checks", async () => {
    const f = fixture({ FILOW_OFFLINE: "1" }); f.api.startupOffline();
    expect(f.blocked("https://cloud.invalid/upload")).toBe(true);
    expect(f.blocked("http://127.0.0.1:4747/api/decide")).toBe(false);
    await f.api.checkForUpdates(); expect(f.checkForUpdates).not.toHaveBeenCalled();
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
    f.api.setLog("phone joined via https://drives-pulling-agrees-ambassador.trycloudflare.com/s/1 with sk-or-v1-0123456789abcdef0123456789abcdef");
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
