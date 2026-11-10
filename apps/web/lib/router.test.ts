import { describe, expect, it } from "vitest";
import { setupChoices, type MachineInfo } from "@filow/core";
import { buildPlan, takeModeOf, type DecisionChoice, type Plan, type PlanInput, type SttChoice } from "./router";

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

describe("model router with a setup profile", () => {
  const old: MachineInfo = { ramGb: 8, cores: 4, gpu: { kind: "none", vramGb: null }, freeDiskGb: 100 };
  const rig: MachineInfo = { ramGb: 32, cores: 22, gpu: { kind: "discrete", vramGb: 8 }, freeDiskGb: 100 };

  it("Lite with an OpenRouter key: decisions stay on this computer (the matcher), no cloud", () => {
    const p = buildPlan({ ...base, keys: { ...base.keys, openrouter: true }, sherpaReady: true, setup: setupChoices("lite", old) });
    expect(p.decision).toEqual({ provider: "matcher", reason: "setup", measuredMs: null });
    expect(p.stt.backend).toBe("sherpa");
    expect(p.expectedTickMs).toBe(1500 + 50 + 250);
  });

  it("Advanced uses Clef when it is installed, the matcher until it is (never the cloud)", () => {
    const adv = setupChoices("advanced", rig);
    const keys = { ...base.keys, openrouter: true };
    const gpu = { kind: "discrete" as const, vramTotalGb: 8 };
    expect(buildPlan({ ...base, keys, gpu, ramGb: 32, installed: ["clef-flash:latest"], ollamaOk: true, setup: adv }).decision).toMatchObject({ provider: "clef-local", reason: "setup" });
    expect(buildPlan({ ...base, keys, gpu, ramGb: 32, installed: [], ollamaOk: true, setup: adv }).decision).toMatchObject({ provider: "matcher", reason: "clef-missing" });
    expect(buildPlan({ ...base, keys, installed: ["clef-flash:latest"], ollamaOk: false, setup: adv }).decision.provider).toBe("matcher");
  });

  // Review T2 finding 1: Auto + an ElevenLabs key + speech model not installed sent the audio to the
  // cloud while the take was shown as local.
  it("a setup never sends the audio out: no local speech engine ready = none, said plainly, even with every key", () => {
    const keys = { openrouter: true, elevenlabs: true, openai: true, cloudflare: true };
    for (const profile of ["lite", "standard", "advanced"] as const) {
      const p = buildPlan({ ...base, keys, webSpeech: true, setup: setupChoices(profile, rig) });
      expect(p.stt).toEqual({ backend: null, reason: "local-speech-missing", expectedLagMs: null });
      expect(takeModeOf(p)).toBeNull();
    }
  });

  it("a setup uses the speech engines on this computer: streaming first, then a downloaded Whisper", () => {
    const keys = { ...base.keys, elevenlabs: true, openai: true };
    const lite = setupChoices("lite", old);
    expect(buildPlan({ ...base, keys, sherpaReady: true, whisperCached: true, setup: lite }).stt.backend).toBe("sherpa");
    const w = buildPlan({ ...base, keys, webSpeech: true, whisperCached: true, setup: lite });
    expect(w.stt.backend).toBe("whisper");
    expect(takeModeOf(w)).toBe("local");
  });
});

describe("takeModeOf: a take is local only when the audio and the decisions both stay here", () => {
  const plan = (stt: SttChoice | null, provider: DecisionChoice | null) =>
    ({ ...buildPlan(base), stt: { backend: stt, reason: "x", expectedLagMs: null }, decision: { provider, reason: "x", measuredMs: null } }) as Plan;
  it("local, cloud, or neither (mixed or missing: the page asks)", () => {
    expect(takeModeOf(plan("sherpa", "matcher"))).toBe("local");
    expect(takeModeOf(plan("whisper", "clef-local"))).toBe("local");
    expect(takeModeOf(plan("elevenlabs", "matcher"))).toBeNull();
    expect(takeModeOf(plan("browser", "clef-local"))).toBeNull();
    expect(takeModeOf(plan("sherpa", "openrouter"))).toBeNull();
    expect(takeModeOf(plan("elevenlabs", "openrouter"))).toBe("cloud");
    expect(takeModeOf(plan(null, "matcher"))).toBeNull();
  });
});
