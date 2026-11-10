import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const { setupOffer, setupChoice, installedModels, probeSetup, createOfferGate } =createRequire(import.meta.url)("./welcome-setup.js");

const CATALOG = {
  "nemotron-streaming": { dl: 0.45, ollama: false, label: "Nemotron streaming speech-to-text" },
  "whisper-small": { dl: 0.5, ollama: false, label: "Whisper small" },
  "clef-flash": { dl: 11, ollama: true, label: "Clef Flash (local decisions)" },
  "gemma4:e4b": { dl: 9, ollama: true, label: "Gemma 4 E4B (script from slides)" },
  "qwen3-vl:2b": { dl: 1.9, ollama: true, label: "Qwen3-VL 2B (OK Filow screen helper, fastest)" },
};
const hw = { ramGb: 32, platform: "win32" };
const rec = { models: ["nemotron-streaming", "whisper-small", "clef-flash", "gemma4:e4b", "qwen3-vl:2b"], ollama: true };
const none = { sherpa: false, ollamaRunning: false, ollamaModels: [] as string[] };

describe("setup offer", () => {
  it("on a fresh PC offers the whole recommendation with its real size and Ollama", () => {
    const o = setupOffer({ hw, rec, catalog: CATALOG, installed: none, online: true });
    expect(o).toMatchObject({ ask: true, ready: false, downloadGb: 22.8, needsOllama: true, device: "pc", ramGb: 32, online: true, profile: null });
    expect(o.labels).toEqual(rec.models.map((n) => CATALOG[n as keyof typeof CATALOG].label));
  });
  it("counts only what is missing, and is ready when the take models are there", () => {
    const o = setupOffer({ hw, rec, catalog: CATALOG, installed: { sherpa: true, ollamaRunning: true, ollamaModels: ["clef-flash:latest", "gemma4:e4b", "qwen3-vl:2b"] }, online: true });
    expect(o).toMatchObject({ ready: true, downloadGb: 0.5, needsOllama: false });
  });
  it("is not ready without the decision model, even with speech installed", () => {
    const o = setupOffer({ hw, rec, catalog: CATALOG, installed: { sherpa: true, ollamaRunning: true, ollamaModels: [] }, online: true });
    expect(o.ready).toBe(false);
  });
  it("asks nothing when the installer already chose, or there is nothing to recommend", () => {
    expect(setupOffer({ hw, rec, catalog: CATALOG, installed: none, online: true, installerChose: true }).ask).toBe(false);
    expect(setupOffer({ hw, rec: { models: [], ollama: false }, catalog: CATALOG, installed: none, online: true }).ask).toBe(false);
  });
  it("says Mac on macOS", () => {
    expect(setupOffer({ hw: { ...hw, platform: "darwin" }, rec, catalog: CATALOG, installed: none, online: true }).device).toBe("mac");
  });
});

describe("setup choice", () => {
  const offer = (installed = none, online = true) => setupOffer({ hw, rec, catalog: CATALOG, installed, online });
  it("accepting a download returns the installer-style choices main() already understands", () => {
    expect(setupChoice(offer(), rec, true)).toEqual({ models: rec.models, ollama: true });
  });
  it("declining, being offline or being ready downloads nothing and opens the prompter", () => {
    expect(setupChoice(offer(), rec, false)).toBeNull();
    expect(setupChoice(offer(none, false), rec, true)).toBeNull();
    expect(setupChoice(offer({ sherpa: true, ollamaRunning: true, ollamaModels: ["clef-flash", "gemma4:e4b", "qwen3-vl:2b"] }), rec, true)).toBeNull();
  });
});

describe("offer gate (the welcome shows before the hardware scan)", () => {
  const flush = () => new Promise((r) => setTimeout(r, 5));
  it("a request that arrives before the window is shown waits: no scan until open()", async () => {
    const order: string[] = [];
    const gate = createOfferGate(() => { order.push("scan"); return { ok: 1 }; });
    const answer = gate.get();
    await flush();
    expect(order).toEqual([]);
    order.push("shown");
    gate.open();
    expect(await answer).toEqual({ ok: 1 });
    expect(order).toEqual(["shown", "scan"]);
  });
  it("the scan starts a turn after open(), not inside it or in its microtasks", async () => {
    const compute = vi.fn(() => 1);
    const gate = createOfferGate(compute);
    void gate.get();
    gate.open();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(compute).not.toHaveBeenCalled();
    await flush();
    expect(compute).toHaveBeenCalledTimes(1);
  });
  it("scans once, and tries again after a failed scan", async () => {
    let n = 0;
    const gate = createOfferGate(() => { n++; if (n === 1) throw new Error("scan failed"); return n; });
    gate.open();
    await expect(gate.get()).rejects.toThrow("scan failed");
    expect(await gate.get()).toBe(2);
    expect(await gate.get()).toBe(2);
    expect(n).toBe(2);
  });
});

describe("installed models", () => {
  it("reads Ollama tags with and without :latest", () => {
    expect(installedModels({ models: [{ name: "clef-flash:latest" }, { name: "gemma4:e4b" }] })).toEqual(["clef-flash", "gemma4:e4b"]);
    expect(installedModels(null)).toEqual([]);
    expect(installedModels({ models: "nope" })).toEqual([]);
  });
  it("probe never throws: Ollama down means not running, no models", async () => {
    const fetchJson = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    expect(await probeSetup({ fetchJson, sherpaReady: () => true })).toEqual({ sherpa: true, ollamaRunning: false, ollamaModels: [] });
  });
  it("probe reads the tags when Ollama answers", async () => {
    const fetchJson = vi.fn(async () => ({ models: [{ name: "clef-flash:latest" }] }));
    expect(await probeSetup({ fetchJson, sherpaReady: () => false })).toEqual({ sherpa: false, ollamaRunning: true, ollamaModels: ["clef-flash"] });
  });
});
