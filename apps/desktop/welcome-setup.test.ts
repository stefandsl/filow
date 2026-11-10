import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const { setupOffer, setupChoice, installedModels, probeSetup } = createRequire(import.meta.url)("./welcome-setup.js");

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
