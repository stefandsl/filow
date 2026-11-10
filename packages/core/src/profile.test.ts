import { describe, expect, it } from "vitest";
import { missingModels, recommendProfile, resolveSetup, setupChoices, sttThreads, type MachineInfo } from "./profile";

const machine = (ramGb: number, cores: number, gpu: MachineInfo["gpu"] = { kind: "none", vramGb: null }, freeDiskGb: number | null = 200): MachineInfo => ({ ramGb, cores, gpu, freeDiskGb });
const igpu = { kind: "integrated" as const, vramGb: 0.5 };
const rtx = (vramGb: number) => ({ kind: "discrete" as const, vramGb });

describe("recommendProfile", () => {
  it("old laptops get Lite: 4 to 8 GB, 2 to 4 cores, no graphics card", () => {
    for (const m of [machine(4, 2), machine(4, 4), machine(8, 2), machine(8, 4), machine(8, 4, igpu), machine(6, 4, igpu)]) {
      expect(recommendProfile(m), JSON.stringify(m)).toEqual({ profile: "lite", reason: "low-ram" });
    }
  });

  it("a typical 16 GB laptop gets Standard", () => {
    expect(recommendProfile(machine(16, 8, igpu))).toEqual({ profile: "standard", reason: "ram-and-cores" });
    expect(recommendProfile(machine(16, 12))).toEqual({ profile: "standard", reason: "ram-and-cores" });
  });

  it("a GPU workstation gets Advanced", () => {
    expect(recommendProfile(machine(32, 22, rtx(8)))).toEqual({ profile: "advanced", reason: "gpu" });
    expect(recommendProfile(machine(64, 32, rtx(24)))).toEqual({ profile: "advanced", reason: "gpu" });
    expect(recommendProfile(machine(32, 10, { kind: "unified", vramGb: 32 }))).toEqual({ profile: "advanced", reason: "unified" });
  });

  it("boundaries: RAM 12, cores 6, video memory 8 and 4, RAM 16 for the GPU, disk 16", () => {
    expect(recommendProfile(machine(11, 8)).profile).toBe("lite");
    expect(recommendProfile(machine(12, 6)).profile).toBe("standard");
    expect(recommendProfile(machine(16, 5))).toEqual({ profile: "lite", reason: "few-cores" });
    expect(recommendProfile(machine(16, 8, rtx(7.9))).profile).toBe("standard");
    expect(recommendProfile(machine(16, 8, rtx(8))).profile).toBe("advanced");
    expect(recommendProfile(machine(15, 8, rtx(8))).profile).toBe("standard");
    expect(recommendProfile(machine(8, 4, rtx(4)))).toEqual({ profile: "standard", reason: "small-gpu" });
    expect(recommendProfile(machine(8, 4, rtx(3.9))).profile).toBe("lite");
    expect(recommendProfile(machine(32, 16, rtx(8), 15))).toEqual({ profile: "standard", reason: "low-disk" });
    expect(recommendProfile(machine(32, 16, rtx(8), 16)).profile).toBe("advanced");
    expect(recommendProfile(machine(32, 16, rtx(8), null)).profile).toBe("advanced");
    expect(recommendProfile(machine(16, 8, { kind: "unified", vramGb: 16 })).profile).toBe("standard");
  });

  it("an integrated GPU never counts as a graphics card, whatever memory it reports", () => {
    expect(recommendProfile(machine(32, 16, { kind: "integrated", vramGb: 16 })).profile).toBe("standard");
  });
});

describe("setupChoices", () => {
  it("Lite: no language model in the decision loop, pictures off, text answers when 6 GB allow", () => {
    const c = setupChoices("lite", machine(8, 4));
    expect(c.decision).toEqual({ provider: "matcher", model: null });
    expect(c.gate).toEqual({ on: true, narrow: true });
    expect(c.stt).toEqual({ backend: "sherpa", threads: 2, browserWhisper: "onnx-community/whisper-base" });
    expect(c.screenHelper).toEqual({ mode: "text", model: "lfm3-vl" });
    expect(c.models.some((m) => m.name === "clef-flash")).toBe(false);
    expect(setupChoices("lite", machine(4, 2)).screenHelper).toEqual({ mode: "none", model: null });
    expect(setupChoices("lite", machine(6, 2)).screenHelper.mode).toBe("text");
  });

  it("Standard: the matcher decides, the small picture model reads the screen", () => {
    const c = setupChoices("standard", machine(16, 8, igpu));
    expect(c.decision.provider).toBe("matcher");
    expect(c.screenHelper).toEqual({ mode: "picture", model: "lfm3-vl" });
    expect(c.stt.threads).toBe(4);
    expect(c.models.filter((m) => m.use === "take").map((m) => m.name)).toEqual(["nemotron-streaming", "paraphrase-multilingual-MiniLM-L12-v2"]);
  });

  it("Advanced: Clef Flash behind a gate that only skips calls, Qwen3-VL for pictures", () => {
    const c = setupChoices("advanced", machine(32, 22, rtx(8)));
    expect(c.decision).toEqual({ provider: "clef-local", model: "clef-flash" });
    expect(c.gate.narrow).toBe(false);
    expect(c.screenHelper).toEqual({ mode: "picture", model: "qwen3-vl:2b" });
    expect(c.stt.browserWhisper).toBe("onnx-community/whisper-small");
  });

  it("speech threads follow stt.js: 2 to 4, two cores left to the app", () => {
    expect([2, 4, 5, 6, 8, 22].map(sttThreads)).toEqual([2, 2, 3, 4, 4, 4]);
  });
});

describe("resolveSetup", () => {
  it("auto follows the machine; a pinned profile wins and is flagged when heavier", () => {
    const old = machine(8, 4);
    expect(resolveSetup("auto", old)).toMatchObject({ recommended: "lite", active: "lite", heavierThanRecommended: false });
    expect(resolveSetup("advanced", old)).toMatchObject({ recommended: "lite", active: "advanced", heavierThanRecommended: true });
    expect(resolveSetup("advanced", old).choices.decision.provider).toBe("clef-local");
    expect(resolveSetup("lite", machine(32, 22, rtx(8)))).toMatchObject({ recommended: "advanced", active: "lite", heavierThanRecommended: false });
  });
});

describe("missingModels", () => {
  it("lists what is not installed; tags without a version match any version", () => {
    const adv = setupChoices("advanced", machine(32, 22, rtx(8)));
    expect(missingModels(adv, { ollama: ["clef-flash:latest", "qwen3-vl:2b"], sherpa: true })).toEqual([]);
    expect(missingModels(adv, { ollama: ["qwen3-vl:8b"], sherpa: false }).map((m) => m.name)).toEqual(["nemotron-streaming", "clef-flash", "qwen3-vl:2b"]);
    const std = setupChoices("standard", machine(16, 8));
    expect(missingModels(std, { ollama: ["lfm3-vl:latest"], sherpa: true })).toEqual([]);
    expect(missingModels(std, { ollama: [], sherpa: true }).map((m) => [m.name, m.use])).toEqual([["lfm3-vl", "screen"]]);
  });
});
