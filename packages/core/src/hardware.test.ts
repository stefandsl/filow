import { describe, expect, it } from "vitest";
import { classifyAdapter, detectGpu, freeGbAt, ollamaModelsDir, parseNvidiaSmi, parseWinAdapters, pickAdapter, type ProbeRunner } from "./hardware";
import { recommendProfile } from "./profile";

import { fixtureRunner, GB, GPU_FIXTURES } from "./hardware.fixtures";

describe("graphics card detection (shared by the desktop app and the server)", () => {
  for (const f of GPU_FIXTURES) {
    it(f.label, async () => {
      const g = await detectGpu(fixtureRunner(f), { platform: "win32", cpuModel: "x", totalMemBytes: 16 * GB });
      expect({ kind: g.kind, vramGb: g.vramGb, ollama: g.ollama }).toEqual(f.want);
    });
  }

  it("a card Ollama cannot use never makes Best quality: Arc A750 and 780M on 16 GB get Balanced", async () => {
    for (const label of ["Intel Arc A750 8 GB (Ollama cannot use it)", "AMD Ryzen 7 8845HS with Radeon 780M (8 GB carved out in the BIOS)"]) {
      const f = GPU_FIXTURES.find((x) => x.label === label)!;
      const g = await detectGpu(fixtureRunner(f), { platform: "win32", cpuModel: "x", totalMemBytes: 16 * GB });
      expect(recommendProfile({ ramGb: 16, cores: 8, gpu: { kind: g.kind, vramGb: g.vramGb, ollama: g.ollama }, freeDiskGb: 500 }).profile, label).toBe("standard");
    }
  });

  it("Apple silicon is unified memory Ollama runs on; an Intel Mac has no usable card", async () => {
    const none: ProbeRunner = async () => "";
    expect(await detectGpu(none, { platform: "darwin", cpuModel: "Apple M2 Pro", totalMemBytes: 32 * GB })).toMatchObject({ kind: "unified", vramGb: 32, ollama: true });
    expect(await detectGpu(none, { platform: "darwin", cpuModel: "Intel(R) Core(TM) i9", totalMemBytes: 32 * GB })).toMatchObject({ kind: "none" });
  });

  it("parses the probe outputs defensively", () => {
    expect(parseNvidiaSmi("")).toBeNull();
    expect(parseNvidiaSmi("NVIDIA RTX A6000, 49140\r\nNVIDIA RTX A6000, 49140")).toEqual({ name: "NVIDIA RTX A6000", vramGb: 48 });
    expect(parseNvidiaSmi("garbage")).toBeNull();
    expect(parseWinAdapters("not json")).toEqual([]);
    expect(parseWinAdapters(JSON.stringify({ name: "X", bytes: 0 }))).toEqual([{ name: "X", memGb: null }]);
    expect(classifyAdapter("", 8)).toMatchObject({ kind: "none" });
    expect(pickAdapter([])).toMatchObject({ kind: "none" });
  });
});

describe("free disk where Ollama keeps the models", () => {
  it("OLLAMA_MODELS when set, else ~/.ollama/models", () => {
    expect(ollamaModelsDir({ OLLAMA_MODELS: "G:\\ollama\\models" }, "C:\\Users\\a", "\\")).toBe("G:\\ollama\\models");
    expect(ollamaModelsDir({}, "C:\\Users\\a\\", "\\")).toBe("C:\\Users\\a\\.ollama\\models");
    expect(ollamaModelsDir({ OLLAMA_MODELS: "  " }, "/home/a", "/")).toBe("/home/a/.ollama/models");
  });

  it("measures the nearest folder that exists (the models folder may not exist yet)", () => {
    const exists: Record<string, number> = { "G:\\": 900 };
    const statfs = (p: string) => {
      if (!(p in exists)) throw new Error("ENOENT");
      return { bavail: exists[p] * 1024, bsize: 1024 ** 2 };
    };
    const parent = (p: string) => (p === "G:\\" ? p : p.slice(0, Math.max(3, p.lastIndexOf("\\"))).replace(/^([A-Z]:)$/, "$1\\"));
    expect(freeGbAt("G:\\ollama\\models", statfs, parent)).toBe(900);
    expect(freeGbAt("Q:\\x", statfs, (p) => (p === "Q:\\" ? p : "Q:\\"))).toBeNull();
  });
});
