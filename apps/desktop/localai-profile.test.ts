import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { recommendProfile, setupChoices, type MachineInfo } from "@filow/core";

const require = createRequire(import.meta.url);
type Hw = { ramGb: number; cores: number; gpuKind: string; vramGb: number | null; freeGb: number };
const { profileOf, recommend } = require("./localai.js") as {
  profileOf: (hw: Hw) => string;
  recommend: (hw: Hw & { gpuClass?: string }) => { profile: string; models: string[] };
};

// every combination the rules distinguish, and the values just around each threshold
const RAM = [4, 6, 8, 11, 12, 15, 16, 32, 64];
const CORES = [2, 4, 5, 6, 8, 22];
const GPUS: Array<{ kind: MachineInfo["gpu"]["kind"]; vramGb: number | null }> = [
  { kind: "none", vramGb: null },
  { kind: "integrated", vramGb: 0.5 },
  { kind: "discrete", vramGb: 3.9 },
  { kind: "discrete", vramGb: 4 },
  { kind: "discrete", vramGb: 7.9 },
  { kind: "discrete", vramGb: 8 },
  { kind: "discrete", vramGb: 24 },
  { kind: "unified", vramGb: 16 },
];
const DISK = [-1, 15, 16, 500];

describe("first-start recommendation follows the setup profiles", () => {
  it("localai.js picks the same profile as packages/core/src/profile.ts on every machine", () => {
    let n = 0;
    for (const ramGb of RAM)
      for (const cores of CORES)
        for (const gpu of GPUS)
          for (const freeGb of DISK) {
            const core = recommendProfile({ ramGb, cores, gpu, freeDiskGb: freeGb < 0 ? null : freeGb }).profile;
            expect(profileOf({ ramGb, cores, gpuKind: gpu.kind, vramGb: gpu.vramGb, freeGb }), JSON.stringify({ ramGb, cores, gpu, freeGb })).toBe(core);
            n++;
          }
    expect(n).toBe(RAM.length * CORES.length * GPUS.length * DISK.length);
  });

  it("recommends the profile's Ollama models, never Clef below Best quality", () => {
    const cases: Array<[Hw, string]> = [
      [{ ramGb: 8, cores: 4, gpuKind: "none", vramGb: null, freeGb: 100 }, "lite"],
      [{ ramGb: 16, cores: 8, gpuKind: "integrated", vramGb: null, freeGb: 100 }, "standard"],
      [{ ramGb: 32, cores: 22, gpuKind: "discrete", vramGb: 8, freeGb: 400 }, "advanced"],
    ];
    for (const [hw, profile] of cases) {
      const rec = recommend(hw);
      expect(rec.profile).toBe(profile);
      const machine: MachineInfo = { ramGb: hw.ramGb, cores: hw.cores, gpu: { kind: hw.gpuKind as MachineInfo["gpu"]["kind"], vramGb: hw.vramGb }, freeDiskGb: hw.freeGb };
      for (const m of setupChoices(rec.profile as "lite", machine).models.filter((x) => x.runtime === "ollama")) expect(rec.models).toContain(m.name);
      expect(rec.models.includes("clef-flash")).toBe(profile === "advanced");
    }
    expect(recommend({ ramGb: 4, cores: 2, gpuKind: "none", vramGb: null, freeGb: 100 }).models).toEqual(["nemotron-streaming", "whisper-base"]);
  });
});
