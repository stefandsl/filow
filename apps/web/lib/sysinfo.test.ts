import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recommendProfile } from "@filow/core";
import { fixtureRunner, GPU_FIXTURES } from "../../../packages/core/src/hardware.fixtures";
import { detectedGpu, freeDiskGb, gpuInfo, machineInfo, resetGpuDetection, type GpuInfo } from "./sysinfo";

afterEach(() => {
  resetGpuDetection();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// Review T2 finding 4: the server detects the card with the same code and the same fixtures as the
// desktop app (apps/desktop/localai-profile.test.ts), so both pick the same setup profile.
describe("server graphics card detection", () => {
  for (const f of GPU_FIXTURES) {
    it(f.label, async () => {
      if (process.platform !== "win32" && f.nvidia === "") return; // the Windows adapter script only runs on Windows
      resetGpuDetection();
      const g = await detectedGpu(fixtureRunner(f));
      expect({ kind: g.kind, vramGb: g.vramGb, ollama: g.ollama }).toEqual(f.want);
      const info: GpuInfo = { name: g.name, kind: g.kind, vramTotalGb: g.vramGb, ollama: g.ollama, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: g.source };
      const m = machineInfo(info);
      expect(m.gpu).toEqual({ kind: f.want.kind, vramGb: f.want.vramGb, ollama: f.want.ollama });
      // a card Ollama cannot use never gives Best quality, whatever its memory
      if (!f.want.ollama) expect(recommendProfile({ ...m, ramGb: 64, cores: 16, freeDiskGb: 500 }).profile).not.toBe("advanced");
    });
  }

  it("detects once per server run", async () => {
    let calls = 0;
    const counting = async (cmd: string) => {
      calls++;
      return cmd === "nvidia-smi" ? "NVIDIA GeForce RTX 3070, 8192" : "";
    };
    await detectedGpu(counting);
    await detectedGpu(counting);
    expect(calls).toBe(1);
  });
});

// Review T2 finding 7: free disk where the models go, not the home folder
describe("free disk for the setup", () => {
  it("follows OLLAMA_MODELS, measuring its nearest existing folder", () => {
    // two fake drives: the models drive (only its root exists) and the home folder's drive
    const models = path.join(path.parse(process.cwd()).root, "filow-models-drive", "ollama", "models");
    const free: Record<string, number> = { [path.parse(models).root]: 700, [os.homedir()]: 30 };
    vi.spyOn(fs, "statfsSync").mockImplementation(((p: string) => {
      if (!(p in free)) throw new Error("ENOENT");
      return { bavail: free[p], bsize: 1024 ** 3 };
    }) as unknown as typeof fs.statfsSync);
    vi.stubEnv("OLLAMA_MODELS", models);
    expect(freeDiskGb()).toBe(700);
    vi.stubEnv("OLLAMA_MODELS", "");
    // no OLLAMA_MODELS: ~/.ollama/models, which does not exist here, so the home folder is measured
    expect(freeDiskGb()).toBe(30);
  });
});

// Phase 2 speed baseline (FILOW_QA_HARDWARE, set only in QA builds): every hardware read sees the laptop it names.
describe("FILOW_QA_HARDWARE on the server", () => {
  it("gives no graphics card, the laptop's memory and processors, and never runs a probe", async () => {
    vi.stubEnv("FILOW_QA_HARDWARE", "ramGb=16,cores=8,gpu=none");
    const probe = vi.fn(async () => "NVIDIA GeForce RTX 3070, 8192");
    const g = await detectedGpu(probe);
    expect(probe).not.toHaveBeenCalled();
    expect(g).toEqual({ name: "", kind: "none", vramGb: null, ollama: false, source: "none" });
    const info = await gpuInfo();
    expect(info).toEqual({ name: "", kind: "none", vramTotalGb: null, ollama: false, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "none" });
    const m = machineInfo(info, ["lfm3-vl"]);
    expect({ ramGb: m.ramGb, cores: m.cores, gpu: m.gpu, installed: m.installed }).toEqual({ ramGb: 16, cores: 8, gpu: { kind: "none", vramGb: null, ollama: false }, installed: ["lfm3-vl"] });
    expect(recommendProfile({ ...m, freeDiskGb: 100 }).profile).toBe("standard");
  });
  it("leaves the real machine alone without the variable, or with a value the parser refuses", () => {
    for (const v of ["", "ramGb=16,cores=8,gpu=nvidia"]) {
      vi.stubEnv("FILOW_QA_HARDWARE", v);
      const m = machineInfo({ name: "", kind: "none", vramTotalGb: null, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "none" });
      expect(m.cores).toBe(os.cpus().length);
      expect(m.ramGb).toBe(Math.ceil(os.totalmem() / 1024 ** 3));
    }
  });
});
