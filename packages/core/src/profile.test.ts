import { describe, expect, it } from "vitest";
import { ADVANCED_MIN_VRAM_GB, advancedDiskNeedGb, diskNeededGb, DOWNLOAD_SPARE_GB, missingModels, recommendProfile, resolveSetup, setupChoices, SHARED_GPU_FREE_GB, sttThreads, type MachineInfo } from "./profile";

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

  it("boundaries: RAM 12, cores 6, video memory 8 and 4, RAM 16 for the GPU, disk 17 (12.9 GB of downloads + 4 spare)", () => {
    expect(recommendProfile(machine(11, 8)).profile).toBe("lite");
    expect(recommendProfile(machine(12, 6)).profile).toBe("standard");
    expect(recommendProfile(machine(16, 5))).toEqual({ profile: "lite", reason: "few-cores" });
    expect(recommendProfile(machine(16, 8, rtx(7.9))).profile).toBe("standard");
    expect(recommendProfile(machine(16, 8, rtx(8))).profile).toBe("advanced");
    expect(recommendProfile(machine(15, 8, rtx(8))).profile).toBe("standard");
    expect(recommendProfile(machine(8, 4, rtx(4)))).toEqual({ profile: "standard", reason: "small-gpu" });
    expect(recommendProfile(machine(8, 4, rtx(3.9))).profile).toBe("lite");
    expect(recommendProfile(machine(32, 16, rtx(8), 15))).toEqual({ profile: "standard", reason: "low-disk" });
    expect(recommendProfile(machine(32, 16, rtx(8), 16)).profile).toBe("standard");
    expect(recommendProfile(machine(32, 16, rtx(8), null)).profile).toBe("advanced");
    expect(recommendProfile(machine(16, 8, { kind: "unified", vramGb: 16 })).profile).toBe("standard");
  });

  it("an integrated GPU never counts as a graphics card, whatever memory it reports", () => {
    expect(recommendProfile(machine(32, 16, { kind: "integrated", vramGb: 16 })).profile).toBe("standard");
  });

  // Review T2 finding 4: Ollama runs Clef on the processor on cards it cannot use (Intel Arc, most Radeons)
  it("a graphics card Ollama cannot use counts as none", () => {
    const arc = (vramGb: number) => ({ kind: "discrete" as const, vramGb, ollama: false });
    expect(recommendProfile(machine(16, 8, arc(8)))).toEqual({ profile: "standard", reason: "ram-and-cores" });
    expect(recommendProfile(machine(32, 16, arc(16)))).toEqual({ profile: "standard", reason: "ram-and-cores" });
    expect(recommendProfile(machine(8, 4, arc(8)))).toEqual({ profile: "lite", reason: "low-ram" });
    expect(recommendProfile(machine(16, 8, { kind: "discrete", vramGb: 8, ollama: true })).profile).toBe("advanced");
  });
});

// Independent review of the T2 fixes: the setup must not change by itself once its own downloads
// fill the disk, and a screen helper that cannot be downloaded is not promised.
describe("disk space and what is already downloaded", () => {
  const rig = (freeDiskGb: number, installed?: string[]): MachineInfo => ({ ramGb: 32, cores: 16, gpu: rtx(8), freeDiskGb, installed });
  it("Best quality stays Best quality after its 12.9 GB of downloads (20 GB free before, 6 after)", () => {
    expect(recommendProfile(rig(20)).profile).toBe("advanced");
    expect(recommendProfile(rig(6, ["clef-flash:latest", "qwen3-vl:2b"])).profile).toBe("advanced");
    expect(recommendProfile(rig(6, ["clef-flash:latest"])).profile).toBe("advanced"); // 1.9 + 4 spare fit in 6
    expect(recommendProfile(rig(5, ["clef-flash:latest"]))).toEqual({ profile: "standard", reason: "low-disk" });
    expect(advancedDiskNeedGb({})).toBe(17);
    expect(advancedDiskNeedGb({ installed: ["clef-flash:latest", "qwen3-vl:2b"] })).toBe(0);
  });
  it("no room for the small screen helper: none, said to be the disk, and nothing to download for it", () => {
    for (const p of ["standard", "lite"] as const) {
      const c = setupChoices(p, machine(16, 8, igpu, 5));
      expect(c.screenHelper, p).toEqual({ mode: "none", model: null, waitsForDecisions: false, lacking: "disk" });
      expect(c.models.some((m) => m.name === "lfm3-vl"), p).toBe(false);
      expect(setupChoices(p, machine(16, 8, igpu, 6)).screenHelper.model, p).toBe("lfm3-vl");
      expect(setupChoices(p, { ...machine(16, 8, igpu, 1), installed: ["lfm3-vl:latest"] }).screenHelper.model, p).toBe("lfm3-vl");
    }
    expect(diskNeededGb([{ name: "lfm3-vl", downloadGb: 1.5, runtime: "ollama", use: "screen" }], [])).toBe(DOWNLOAD_SPARE_GB + 1.5);
  });
});

// Review T2 finding 3: on 8 to 11 GB Clef Flash stays loaded and picture answers waited 60 to 300 s
describe("Best quality on a card under 12 GB (owner decision D26 open)", () => {
  it("the threshold stays at 8 GB until D26 says otherwise", () => {
    expect(ADVANCED_MIN_VRAM_GB).toBe(8);
    expect(SHARED_GPU_FREE_GB).toBe(12);
  });
  it("says that screen answers wait behind Clef under 12 GB, and promise about a second from 12 GB", () => {
    for (const [vram, waits, s] of [[8, true, 300], [11.9, true, 300], [12, false, 1], [24, false, 1]] as const) {
      const c = setupChoices("advanced", machine(32, 16, rtx(vram)));
      expect(c.screenHelper.waitsForDecisions, String(vram)).toBe(waits);
      expect(c.budget.screenAnswerS, String(vram)).toBe(s);
    }
    expect(setupChoices("advanced", machine(32, 10, { kind: "unified", vramGb: 32 })).screenHelper.waitsForDecisions).toBe(false);
  });
});

describe("setupChoices", () => {
  it("Lite: no language model in the decision loop, pictures off, text answers when 6 GB allow", () => {
    const c = setupChoices("lite", machine(8, 4));
    expect(c.decision).toEqual({ provider: "matcher", model: null });
    expect(c.gate).toEqual({ on: true, narrow: true });
    expect(c.stt).toEqual({ backend: "sherpa", threads: 2, browserWhisper: "onnx-community/whisper-base" });
    expect(c.screenHelper).toEqual({ mode: "text", model: "lfm3-vl", waitsForDecisions: false });
    expect(c.models.some((m) => m.name === "clef-flash")).toBe(false);
    expect(setupChoices("lite", machine(4, 2)).screenHelper).toEqual({ mode: "none", model: null, waitsForDecisions: false, lacking: "memory" });
    expect(setupChoices("lite", machine(6, 2)).screenHelper.mode).toBe("text");
  });

  it("Standard: the matcher decides, the small picture model reads the screen", () => {
    const c = setupChoices("standard", machine(16, 8, igpu));
    expect(c.decision.provider).toBe("matcher");
    expect(c.screenHelper).toEqual({ mode: "picture", model: "lfm3-vl", waitsForDecisions: false });
    expect(c.stt.threads).toBe(4);
    expect(c.models.filter((m) => m.use === "take").map((m) => m.name)).toEqual(["nemotron-streaming", "paraphrase-multilingual-MiniLM-L12-v2"]);
  });

  it("Advanced: Clef Flash behind a gate that only skips calls, Qwen3-VL for pictures", () => {
    const c = setupChoices("advanced", machine(32, 22, rtx(8)));
    expect(c.decision).toEqual({ provider: "clef-local", model: "clef-flash" });
    expect(c.gate.narrow).toBe(false);
    expect(c.screenHelper).toEqual({ mode: "picture", model: "qwen3-vl:2b", waitsForDecisions: true });
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
