import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import * as helpers from "../../packages/core/src/ui-preferences";
const { createUiPreferences, trustedUiSender, createWelcomeController } = createRequire(import.meta.url)("./ui-preferences.js");

function fixture(options: { platform?: string; packaged?: boolean; portable?: boolean; initial?: Record<string, unknown> } = {}) {
  let settings: Record<string, unknown> = { secret: "never exposed", ...options.initial };
  let os = { openAtLogin: false, status: "not-registered", launchItems: [] as { name: string; path: string; args: string[]; enabled: boolean }[] };
  const app = {
    isPackaged: options.packaged ?? true, getLocale: () => "it-IT",
    getLoginItemSettings: vi.fn(() => os),
    setLoginItemSettings: vi.fn((p: { openAtLogin: boolean }) => { os = { openAtLogin: p.openAtLogin, status: p.openAtLogin ? "enabled" : "not-registered", launchItems: p.openAtLogin ? [{ name: "Filow", path: "G:\\Apps With Spaces\\Filow.exe", args: [], enabled: true }] : [] }; }),
  };
  const nativeTheme = Object.assign(new EventEmitter(), { themeSource: "system", shouldUseDarkColors: false });
  const systemPreferences = Object.assign(new EventEmitter(), { getAccentColor: vi.fn(() => "aabbccff"), subscribeNotification: vi.fn(() => 3), unsubscribeNotification: vi.fn() });
  const save = vi.fn(async (candidate: Record<string, unknown>) => { settings = candidate; });
  const canComplete = vi.fn(() => true);
  const service = createUiPreferences({ app, nativeTheme, systemPreferences, platform: options.platform ?? "win32", portable: options.portable, execPath: "G:\\Apps With Spaces\\Filow.exe", read: () => settings, save, initial: options.initial ?? {}, helpers, canComplete });
  return { service, app, nativeTheme, systemPreferences, save, canComplete, settings: () => settings, externalDisable: () => { os.launchItems.forEach(i => i.enabled = false); }, pending: () => { os.status = "requires-approval"; } };
}
describe("desktop UI authority", () => {
  it("returns a bounded normalized snapshot without touching startup", () => {
    const f = fixture(); expect(f.service.get()).toMatchObject({ lang: "", resolvedLang: "it", theme: "system", accentColor: null });
    expect(JSON.stringify(f.service.get())).not.toContain("secret"); expect(f.app.setLoginItemSettings).not.toHaveBeenCalled(); f.service.dispose();
  });
  it("uses matching Windows path/args and respects external disable", async () => {
    const f = fixture(); expect((await f.service.update({ runAtStartup: true })).ok).toBe(true);
    expect(f.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, enabled: true, name: "Filow", path: "G:\\Apps With Spaces\\Filow.exe", args: [] });
    expect(f.app.getLoginItemSettings).toHaveBeenCalledWith({ path: "G:\\Apps With Spaces\\Filow.exe", args: [] });
    f.externalDisable(); expect(f.service.refresh().startup).toMatchObject({ requested: true, enabled: false, status: "blocked" });
    expect(f.app.setLoginItemSettings).toHaveBeenCalledTimes(1); f.service.dispose();
  });
  it("does not report removal of an externally disabled entry when the OS leaves it registered", async () => {
    const f = fixture();
    await f.service.update({ runAtStartup: true });
    f.externalDisable();
    f.app.setLoginItemSettings.mockImplementation(() => {});
    f.save.mockClear();
    expect(await f.service.update({ runAtStartup: false })).toMatchObject({ ok: false, code: "ui.startupError" });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.settings().runAtStartup).toBe(true);
    f.service.dispose();
  });
  it("removes an externally disabled entry on an explicit off request", async () => {
    const f = fixture();
    await f.service.update({ runAtStartup: true });
    f.externalDisable();
    expect(await f.service.update({ runAtStartup: false })).toMatchObject({ ok: true, state: { startup: { requested: false, enabled: false, status: "disabled" } } });
    expect(f.app.getLoginItemSettings().openAtLogin).toBe(false);
    expect(f.settings().runAtStartup).toBe(false);
    f.service.dispose();
  });
  it.each([{ platform: "linux" }, { packaged: false }, { portable: true }])("never registers unsupported runs %j", async options => {
    const f = fixture(options); expect((await f.service.update({ runAtStartup: true })).ok).toBe(false); expect(f.app.setLoginItemSettings).not.toHaveBeenCalled(); f.service.dispose();
  });
  it("keeps macOS approval pending", async () => {
    const f = fixture({ platform: "darwin" }); f.app.setLoginItemSettings.mockImplementation(() => f.pending());
    expect(await f.service.update({ runAtStartup: true })).toMatchObject({ ok: true, state: { startup: { enabled: false, status: "requires-approval" } } });
    expect(f.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true }); f.service.dispose(); expect(f.systemPreferences.unsubscribeNotification).toHaveBeenCalledTimes(2);
  });
  it("reports OS failures without persisting a request", async () => {
    const f = fixture(); f.app.setLoginItemSettings.mockImplementation(() => { throw new Error("OS"); });
    expect(await f.service.update({ runAtStartup: true })).toMatchObject({ ok: false, code: "ui.startupError" }); expect(f.save).not.toHaveBeenCalled(); f.service.dispose();
  });
  it("reconciles OS success followed by disk failure", async () => {
    const f = fixture(); f.save.mockRejectedValue(new Error("disk"));
    expect(await f.service.update({ runAtStartup: true })).toMatchObject({ ok: false, code: "ui.saveError", state: { startup: { enabled: true, requested: false } } });
    expect(f.settings()).not.toHaveProperty("runAtStartup"); f.service.dispose();
  });
  it("does not claim an off request succeeded when OS readback fails", async () => {
    const f = fixture(); f.app.getLoginItemSettings.mockImplementation(() => { throw new Error("readback unavailable"); });
    expect(await f.service.update({ runAtStartup: false })).toMatchObject({ ok: false, code: "ui.startupError" }); expect(f.save).not.toHaveBeenCalled(); f.service.dispose();
  });
  it("serializes migration with edits and permits retry after failed migration", async () => {
    const f = fixture(); f.save.mockRejectedValueOnce(new Error("disk"));
    expect((await f.service.migrateLegacy({ theme: "dark" })).ok).toBe(false);
    expect((await f.service.migrateLegacy({ theme: "dark" })).ok).toBe(true);
    await Promise.all([f.service.update({ lang: "en" }), f.service.migrateLegacy({ lang: "it" })]);
    expect(f.settings()).toMatchObject({ theme: "dark", lang: "en" }); f.service.dispose();
  });
  it("does not complete or publish uncommitted values on disk failure", async () => {
    const f = fixture(); const listener = vi.fn(); f.service.refresh(); f.service.subscribe(listener); f.save.mockRejectedValue(new Error("disk"));
    expect((await f.service.update({ lang: "en" })).ok).toBe(false); expect((await f.service.complete()).ok).toBe(false);
    expect(f.service.get().lang).toBe(""); expect(f.settings()).not.toHaveProperty("welcomeCompleted"); expect(listener).not.toHaveBeenCalled(); f.service.dispose();
  });
  it("serializes rapid updates and completion, preserving unrelated settings", async () => {
    const f = fixture(); const results = await Promise.all([f.service.update({ theme: "dark" }), f.service.update({ theme: "light" }), f.service.update({ lang: "en" }), f.service.complete()]);
    expect(results.every(r => r.ok)).toBe(true); expect(f.settings()).toMatchObject({ secret: "never exposed", theme: "light", lang: "en", welcomeCompleted: true }); f.service.dispose();
  });
  it("shutdown cannot complete a queued close", async () => {
    const f = fixture(); f.canComplete.mockReturnValue(false); expect((await f.service.complete()).ok).toBe(false); expect(f.save).not.toHaveBeenCalled(); f.service.dispose();
  });
  it("deduplicates OS events, never saves sampled colors, and unsubscribes", async () => {
    const f = fixture(); await f.service.update({ followSystemAccent: true }); const listener = vi.fn(); const stop = f.service.subscribe(listener); f.save.mockClear();
    f.systemPreferences.getAccentColor.mockReturnValue("123456ff"); f.systemPreferences.emit("accent-color-changed"); f.systemPreferences.emit("accent-color-changed");
    expect(listener).toHaveBeenCalledTimes(1); expect(f.save).not.toHaveBeenCalled(); expect(f.service.get().accentColor).toBe("#123456");
    stop(); f.service.dispose(); expect(f.nativeTheme.listenerCount("updated")).toBe(0); expect(f.systemPreferences.listenerCount("accent-color-changed")).toBe(0);
  });
  it("rejects invalid operations and falls back on accent query failure", async () => {
    const f = fixture(); expect((await f.service.update({ secret: "x" })).ok).toBe(false); f.systemPreferences.getAccentColor.mockImplementation(() => { throw new Error(); });
    expect((await f.service.update({ followSystemAccent: true })).state.accentColor).toBeNull(); f.service.dispose();
  });
  it("migrates only missing fields once, never replacing a welcome choice", async () => {
    const f = fixture({ initial: { lang: "" } }); await f.service.migrateLegacy({ lang: "it", theme: "dark" }); expect(f.settings()).toMatchObject({ lang: "", theme: "dark" });
    await f.service.update({ theme: "light" }); await f.service.migrateLegacy({ theme: "dark" }); expect(f.settings().theme).toBe("light"); f.service.dispose();
    const fresh = fixture(); await fresh.service.complete(); await fresh.service.migrateLegacy({ lang: "it" }); expect(fresh.service.get().lang).toBe(""); fresh.service.dispose();
  });
});
it("validates tracked main frames, exact welcome file and app origin", () => {
  const welcome = { mainFrame: { url: "file:///G:/Filow/welcome.html" }, isDestroyed: () => false };
  const page = { mainFrame: { url: "http://127.0.0.1:4747/settings/local" }, isDestroyed: () => false };
  const config = { welcome, pages: [page], welcomeUrl: welcome.mainFrame.url, appUrl: "http://127.0.0.1:4747" };
  expect(trustedUiSender({ sender: welcome, senderFrame: welcome.mainFrame }, config, true)).toBe(true);
  expect(trustedUiSender({ sender: page, senderFrame: page.mainFrame }, config)).toBe(true);
  expect(trustedUiSender({ sender: page, senderFrame: page.mainFrame }, config, true)).toBe(false);
  expect(trustedUiSender({ sender: page, senderFrame: { ...page.mainFrame } }, config)).toBe(false);
  page.mainFrame.url = "https://evil.test"; expect(trustedUiSender({ sender: page, senderFrame: page.mainFrame }, config)).toBe(false);
  welcome.mainFrame.url += "?remote=1"; expect(trustedUiSender({ sender: welcome, senderFrame: welcome.mainFrame }, config, true)).toBe(false);
});

describe("welcome lifecycle", () => {
  function lifecycle() {
    let quitting = false;
    const complete = vi.fn(async () => ({ ok: true }));
    const created: Array<EventEmitter & { focus: ReturnType<typeof vi.fn>; destroy: () => void; isDestroyed: () => boolean }> = [];
    const onFailure = vi.fn(() => { quitting = true; });
    const onSaveFailure = vi.fn(), onClosed = vi.fn(), onFocus = vi.fn();
    const createWindow = vi.fn(() => {
      let destroyed = false;
      const win = Object.assign(new EventEmitter(), { focus: vi.fn(), destroy: () => { destroyed = true; win.emit("closed"); }, isDestroyed: () => destroyed });
      created.push(win); return win;
    });
    const controller = createWelcomeController({ createWindow, complete, isQuitting: () => quitting, onFailure, onSaveFailure, onClosed, onFocus });
    return { controller, complete, created, createWindow, onFailure, onSaveFailure, onClosed, quit: () => { quitting = true; } };
  }
  it("reuses a singleton, finishes once and reopens without restarting setup", async () => {
    const f = lifecycle(), gate = f.controller.show(); expect(f.controller.show()).toBe(gate); expect(f.createWindow).toHaveBeenCalledTimes(1);
    expect(f.created[0].focus).toHaveBeenCalledOnce(); await Promise.all([f.controller.finish(), f.controller.finish(), gate]);
    expect(f.complete).toHaveBeenCalledTimes(1); expect(f.onClosed).toHaveBeenCalledTimes(1); expect(f.controller.getWindow()).toBeNull();
    const menuGate = f.controller.show(); expect(menuGate).not.toBe(gate); expect(f.createWindow).toHaveBeenCalledTimes(2); await f.controller.finish(); await menuGate;
    expect(f.onFailure).not.toHaveBeenCalled();
  });
  it("X completes, but a save failure leaves the window usable", async () => {
    const f = lifecycle(); f.controller.show(); f.complete.mockResolvedValueOnce({ ok: false } as never);
    const event = { preventDefault: vi.fn() }; f.created[0].emit("close", event); await Promise.resolve(); await Promise.resolve();
    expect(event.preventDefault).toHaveBeenCalled(); expect(f.created[0].isDestroyed()).toBe(false); expect(f.onSaveFailure).toHaveBeenCalled();
    await f.controller.finish(); expect(f.created[0].isDestroyed()).toBe(true);
  });
  it("load failure/crash/quit never marks completion", async () => {
    const f = lifecycle(); f.controller.show(); f.controller.fail(); f.controller.fail(); expect(f.onFailure).toHaveBeenCalledTimes(1);
    await f.controller.finish(); expect(f.complete).not.toHaveBeenCalled();
    const shutdown = lifecycle(); shutdown.controller.show(); shutdown.quit(); shutdown.created[0].emit("close", { preventDefault: vi.fn() }); expect(shutdown.complete).not.toHaveBeenCalled();
  });
  it("unexpected destruction fails startup rather than silently completing", async () => {
    const f = lifecycle(); const gate = f.controller.show(); f.created[0].destroy(); await gate;
    expect(f.onFailure).toHaveBeenCalledOnce(); expect(f.complete).not.toHaveBeenCalled();
  });
});
