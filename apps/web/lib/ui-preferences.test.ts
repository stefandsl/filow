import { beforeEach, expect, it, vi } from "vitest";
import type { UiSnapshot } from "@filow/core";
import type { DesktopBridge } from "./sessionUrl";
import { applyUiPreferences } from "./applyUiPreferences";

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });
function storage() {
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  vi.stubGlobal("localStorage", store);
  return store;
}
const snapshot = (revision: number, lang: "" | "en" | "it" = ""): UiSnapshot => ({ revision, lang, resolvedLang: lang || "it", theme: "dark", resolvedTheme: "dark", followSystemAccent: false, accentColor: null, accentSupported: true, startup: { supported: false, requested: false, enabled: false, status: "unsupported" } });
it("mirrors Automatic by removing the explicit language, without echoing IPC", async () => {
  const store = storage(), updatePreferences = vi.fn(); vi.stubGlobal("filow", { updatePreferences });
  const p = await import("./prefs"); const listener = vi.fn(); const unsubscribe = p.subscribeUiPreferences(listener);
  p.receiveUiPreferences(snapshot(2, "en")); p.receiveUiPreferences(snapshot(3)); p.receiveUiPreferences(snapshot(1, "en"));
  expect(p.getLang()).toBe("it"); expect(p.getLanguagePref()).toBe(""); expect(store.getItem("prefs:lang")).toBeNull(); expect(store.getItem("prefs:theme")).toBe("dark");
  expect(updatePreferences).not.toHaveBeenCalled(); expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe(); p.receiveUiPreferences(snapshot(4, "en")); expect(listener).toHaveBeenCalledTimes(2);
});
it("reads only valid legacy browser choices and retains browser-only behavior", async () => {
  const store = storage(); const p = await import("./prefs"); vi.stubGlobal("navigator", { language: "it-CH" });
  expect(p.getLang()).toBe("it"); expect(p.legacyUiPreferences(store)).toEqual({});
  p.setLang("en"); p.setThemePref("light"); expect(p.legacyUiPreferences(store)).toEqual({ lang: "en", theme: "light" });
  p.setLang(""); expect(p.getLang()).toBe("it"); expect(p.getLanguagePref()).toBe("");
  store.setItem("prefs:theme", "wrong"); store.setItem("prefs:lang", "de"); expect(p.legacyUiPreferences(store)).toEqual({}); expect(p.getThemePref()).toBe("system");
});
it("does not optimistically commit rejected desktop preferences", async () => {
  storage(); const state = snapshot(1, "en"); const updatePreferences = vi.fn(async () => ({ ok: false, code: "ui.saveError", state })); vi.stubGlobal("filow", { updatePreferences });
  const p = await import("./prefs"); p.receiveUiPreferences(state); p.setLang("it"); await Promise.resolve(); await Promise.resolve();
  expect(p.getLang()).toBe("en"); expect(p.getUiError()).toBe("ui.saveError"); expect(updatePreferences).toHaveBeenCalledWith({ lang: "it" });
});
it("applies language/theme and removes every accent override on off", () => {
  const vars = new Map<string, string>(), attrs = new Map<string, boolean>();
  const root = { lang: "", dataset: {} as Record<string, string>, toggleAttribute: (key: string, value: boolean) => attrs.set(key, value), style: { setProperty: (k: string, v: string) => vars.set(k, v), removeProperty: (k: string) => vars.delete(k) } };
  vi.stubGlobal("document", { documentElement: root });
  applyUiPreferences({ resolvedLang: "it", resolvedTheme: "light", accentColor: "#000000" });
  expect(root.lang).toBe("it"); expect(root.dataset.theme).toBe("light"); expect(vars.get("--action-foreground")).toBe("#ffffff");
  applyUiPreferences({ resolvedLang: "en", resolvedTheme: "dark", accentColor: null });
  expect(vars.size).toBe(0); expect(attrs.get("data-system-accent")).toBe(false);
});
it("subscribes before get, ignores a late initial response and cleans up", async () => {
  storage(); const p = await import("./prefs"); const calls: string[] = [];
  let listener!: (state: UiSnapshot) => void, resolve!: (state: UiSnapshot) => void;
  const unsubscribe = vi.fn(); const ready = vi.fn(), failure = vi.fn();
  const bridge = {
    onPreferencesChanged: (fn: typeof listener) => { calls.push("subscribe"); listener = fn; return unsubscribe; },
    getPreferences: () => { calls.push("get"); return new Promise<UiSnapshot>(r => { resolve = r; }); },
  } satisfies Pick<DesktopBridge, "getPreferences" | "onPreferencesChanged">;
  const stop = p.connectDesktopPreferences(bridge, ready, failure);
  expect(calls).toEqual(["subscribe", "get"]);
  listener(snapshot(4, "it")); resolve(snapshot(1, "en")); await Promise.resolve(); await Promise.resolve();
  expect(p.getLang()).toBe("it"); expect(ready).toHaveBeenCalledOnce(); expect(failure).not.toHaveBeenCalled();
  stop(); expect(unsubscribe).toHaveBeenCalledOnce(); listener(snapshot(5, "en")); expect(p.getLang()).toBe("it");
});
it("unmount ignores an outstanding initial fetch", async () => {
  storage(); const p = await import("./prefs"); let resolve!: (state: UiSnapshot) => void; const ready = vi.fn();
  const bridge = { getPreferences: () => new Promise<UiSnapshot>(r => { resolve = r; }), onPreferencesChanged: () => () => {} } satisfies Pick<DesktopBridge, "getPreferences" | "onPreferencesChanged">;
  const stop = p.connectDesktopPreferences(bridge, ready, vi.fn()); stop(); resolve(snapshot(10)); await Promise.resolve(); await Promise.resolve();
  expect(ready).not.toHaveBeenCalled(); expect(p.getDesktopPreferences()).toBeNull();
});
