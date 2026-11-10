import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { recommendProfile } from "@filow/core";
import { fixtureRunner, GPU_FIXTURES } from "../../../packages/core/src/hardware.fixtures";
import { detectedGpu, freeDiskGb, machineInfo, resetGpuDetection, type GpuInfo } from "./sysinfo";

afterEach(() => resetGpuDetection());

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
  it("follows OLLAMA_MODELS", () => {
    const prev = process.env.OLLAMA_MODELS;
    try {
      // a folder that does not exist yet, on the drive of the repo: its nearest parent is measured
      process.env.OLLAMA_MODELS = path.join(process.cwd(), "filow-no-such-dir", "models");
      expect(freeDiskGb()).toBe(freeDiskGb(process.cwd()));
      // where the repo and the home folder are on different drives (this test PC: G: and C:), they differ
      if (path.parse(process.cwd()).root.toLowerCase() !== path.parse(os.homedir()).root.toLowerCase()) expect(freeDiskGb()).not.toBe(freeDiskGb(os.homedir()));
      process.env.OLLAMA_MODELS = "";
      expect(freeDiskGb()).toBe(freeDiskGb(os.homedir()));
    } finally {
      if (prev === undefined) delete process.env.OLLAMA_MODELS;
      else process.env.OLLAMA_MODELS = prev;
    }
  });
});
