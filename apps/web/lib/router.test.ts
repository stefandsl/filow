import { describe, expect, it } from "vitest";
import { buildPlan, type PlanInput } from "./router";

const base: PlanInput = {
  installed: [],
  ollamaOk: false,
  gpu: { kind: "none", vramTotalGb: null },
  ramGb: 8,
  keys: { openrouter: false, elevenlabs: false, openai: false, cloudflare: false },
  offline: false,
  sherpaReady: false,
  whisperCached: false,
  webSpeech: false,
  probes: {},
};

describe("model router", () => {
  it("8 GB laptop with nothing installed and an OpenRouter key: cloud everything, browser speech", () => {
    const p = buildPlan({ ...base, keys: { ...base.keys, openrouter: true }, webSpeech: true });
    expect(p.stt.backend).toBe("browser");
    expect(p.decision.provider).toBe("openrouter");
    expect(p.generate.provider).toBe("openrouter");
  });

  it("RTX 3070 desktop with Clef and Nemotron: local streaming speech, local decisions measured faster", () => {
    const p = buildPlan({
      ...base,
      installed: ["clef-flash:latest", "gemma4:e4b"],
      ollamaOk: true,
      gpu: { kind: "discrete", vramTotalGb: 8 },
      ramGb: 128,
      keys: { ...base.keys, openrouter: true, elevenlabs: true },
      sherpaReady: true,
      probes: { clefLocalMs: 180, openrouterMs: 1400 },
    });
    expect(p.stt.backend).toBe("sherpa");
    expect(p.decision).toMatchObject({ provider: "clef-local", reason: "measured-local-faster", measuredMs: 180 });
    expect(p.generate).toMatchObject({ provider: "ollama", model: "gemma4:e4b" });
    expect(p.expectedTickMs).toBe(1500 + 180 + 250);
  });

  it("Clef installed on a CPU-only 16 GB laptop measured slow: cloud decisions win, speech stays local", () => {
    const p = buildPlan({
      ...base,
      installed: ["clef-flash:latest"],
      ollamaOk: true,
      ramGb: 16,
      keys: { ...base.keys, openrouter: true },
      sherpaReady: true,
      probes: { clefLocalMs: 3800, openrouterMs: 1300 },
    });
    expect(p.stt.backend).toBe("sherpa");
    expect(p.decision).toMatchObject({ provider: "openrouter", reason: "measured-cloud-faster" });
  });

  it("offline: only local candidates, even when keys exist", () => {
    const p = buildPlan({
      ...base,
      installed: ["clef-flash:latest", "gemma4:e2b"],
      ollamaOk: true,
      ramGb: 16,
      keys: { openrouter: true, elevenlabs: true, openai: true, cloudflare: true },
      offline: true,
      whisperCached: true,
    });
    expect(p.stt.backend).toBe("whisper");
    expect(p.decision.provider).toBe("clef-local");
    expect(p.generate).toMatchObject({ provider: "ollama", model: "gemma4:e2b" });
    expect(p.vision.provider).toBe("none");
  });

  it("local probe failed (null) falls back to cloud when a key exists", () => {
    const p = buildPlan({ ...base, installed: ["clef-flash"], ollamaOk: true, ramGb: 32, keys: { ...base.keys, openrouter: true }, probes: { clefLocalMs: null, openrouterMs: 1500 } });
    expect(p.decision.provider).toBe("openrouter");
  });
});
