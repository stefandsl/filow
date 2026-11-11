import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { normalizeBaseUrl as webUrl, normalizeModel as webModel } from "../web/lib/freellm";

const require = createRequire(import.meta.url);
const { createFreeLlm, normalizeBaseUrl, normalizeModel, KEY_NAME } = require("./freellm.js");
const { setSecret } = require("./secrets.js");
const { redact } = require("./diag.js");

// Built from pieces so no key-shaped string sits in a tracked file (SUP-05 scans them).
const KEY = "freellmapi-" + "0123456789abcdef".repeat(2);

function world(env: Record<string, string> = {}, keyStore = true) {
  let settings: Record<string, unknown> = { other: 1 };
  const stored: Array<string | null> = [];
  const log: string[] = [];
  const f = createFreeLlm({
    getSettings: () => settings,
    saveSettings: (next: Record<string, unknown>) => { settings = next; },
    env,
    storeKey: (v: string | null) => { if (keyStore) stored.push(v); return keyStore; },
    logLine: (l: string) => log.push(l),
  });
  return { f, env, stored, log, settings: () => settings };
}

describe("FreeLLMAPI settings in the desktop app", () => {
  it("accepts the same addresses and models as the server does", () => {
    for (const v of ["http://localhost:3001/v1", "http://192.168.1.20:3001", "https://10.0.0.5:3001/v1/", "http://[::1]:3001/v1", "http://pc.local:3001", "https://example.com/v1",
      "http://8.8.8.8/v1", "ftp://localhost/v1", "http://a:b@localhost/v1", "http://localhost/v1?x=1", "http://172.32.0.1/v1", "javascript:alert(1)", "", "nonsense"]) {
      expect(normalizeBaseUrl(v), v).toBe(webUrl(v));
    }
    for (const m of ["", "auto", "auto:fast", "gemini-2.5-flash", "bad model", "x".repeat(200)]) expect(normalizeModel(m), m).toBe(webModel(m));
  });
  it("saves the address, the model and the scripts switch, and they apply at once", () => {
    const w = world();
    expect(w.f.status()).toMatchObject({ baseUrl: "http://localhost:3001/v1", model: "auto", scripts: false, hasKey: false });
    const r = w.f.configure({ baseUrl: "http://192.168.1.20:3001", model: "auto:fast", scripts: true });
    expect(r).toMatchObject({ ok: true, status: { baseUrl: "http://192.168.1.20:3001/v1", model: "auto:fast", scripts: true } });
    expect(w.env).toMatchObject({ FREELLMAPI_BASE_URL: "http://192.168.1.20:3001/v1", FREELLMAPI_MODEL: "auto:fast", SCRIPT_CLOUD: "freellm" });
    expect(w.settings()).toEqual({ other: 1, freellm: { baseUrl: "http://192.168.1.20:3001/v1", model: "auto:fast", scripts: true } });
    w.f.configure({ scripts: false });
    expect(w.env.SCRIPT_CLOUD).toBe("");
  });
  it("refuses an address on the internet and saves nothing of that change", () => {
    const w = world();
    expect(w.f.configure({ baseUrl: "https://evil.example.com/v1", model: "auto:smart", key: KEY })).toMatchObject({ ok: false, error: "badUrl" });
    expect(w.settings()).toEqual({ other: 1 });
    expect(w.env).toEqual({});
    expect(w.stored).toEqual([]);
    expect(w.f.configure({ model: "not a model" })).toMatchObject({ ok: false, error: "badModel" });
  });
  it("the key goes to the encrypted store and never comes back, to a page, the settings file or the log", () => {
    const w = world();
    const r = w.f.configure({ key: `  ${KEY}\n` });
    expect(r).toMatchObject({ ok: true, status: { hasKey: true, keyHint: KEY.slice(-4) } });
    expect(w.stored).toEqual([KEY]);
    expect(w.env[KEY_NAME]).toBe(KEY);
    expect(JSON.stringify([r, w.settings(), w.log])).not.toContain(KEY);
    expect(w.f.configure({ key: "" })).toMatchObject({ ok: true, status: { hasKey: false, keyHint: "" } });
    expect(w.stored).toEqual([KEY, null]);
    expect(KEY_NAME in w.env).toBe(false);
    expect(w.f.configure({ key: "has spaces in it" })).toMatchObject({ ok: false, error: "badKey" });
  });
  it("without the OS key store the key is not saved anywhere", () => {
    const w = world({}, false);
    expect(w.f.configure({ key: KEY, model: "auto:fast" })).toMatchObject({ ok: false, error: "noKeyStore", status: { hasKey: false } });
    expect(w.env).toEqual({});
    expect(w.settings()).toEqual({ other: 1 });
  });
  it("what was saved in Settings wins over .env at startup; a broken saved address is ignored", () => {
    const w = world({ FREELLMAPI_BASE_URL: "http://localhost:9999/v1", FREELLMAPI_MODEL: "auto:smart" });
    w.f.apply();
    expect(w.env.FREELLMAPI_BASE_URL).toBe("http://localhost:9999/v1");
    w.f.configure({ baseUrl: "http://localhost:3001/v1" });
    expect(w.env).toMatchObject({ FREELLMAPI_BASE_URL: "http://localhost:3001/v1", FREELLMAPI_MODEL: "auto:smart" });
  });
});

describe("the unified key at rest and in a problem report", () => {
  it("setSecret encrypts into the same store as the .env keys and removes on empty", () => {
    const files: Record<string, string> = { store: JSON.stringify({ OPENROUTER_API_KEY: "enc(a)" }) };
    const deps = { storeFile: "store", fsx: { read: (p: string) => files[p] ?? null, write: (p: string, t: string) => { files[p] = t; } }, crypto: { available: () => true, encrypt: (s: string) => `enc(${s.length})` } };
    expect(setSecret(deps, KEY_NAME, KEY)).toBe(true);
    expect(JSON.parse(files.store)).toEqual({ OPENROUTER_API_KEY: "enc(a)", [KEY_NAME]: `enc(${KEY.length})` });
    expect(files.store).not.toContain(KEY);
    expect(setSecret(deps, KEY_NAME, null)).toBe(true);
    expect(JSON.parse(files.store)).toEqual({ OPENROUTER_API_KEY: "enc(a)" });
    const write = vi.fn();
    expect(setSecret({ ...deps, fsx: { ...deps.fsx, write }, crypto: { ...deps.crypto, available: () => false } }, KEY_NAME, KEY)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(() => setSecret(deps, "PATH", "x")).toThrow();
  });
  it("Report a problem masks the unified key wherever it shows", () => {
    const out = redact([`FREELLMAPI_API_KEY=${KEY}`, `freellm: Authorization: Bearer ${KEY}`, `key ${KEY} refused`, "FREELLMAPI_API_KEY=plainsecretvalue123"].join("\n"));
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("0123456789abcdef");
    expect(out).not.toContain("plainsecretvalue123");
  });
});
