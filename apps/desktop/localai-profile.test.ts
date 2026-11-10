import fs from "node:fs";
import path from "node:path";
import { runInThisContext } from "node:vm";
import Module, { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { recommendProfile, setupChoices, sttThreads, type MachineInfo, type ProbeRunner } from "@filow/core";
import { fixtureRunner, GPU_FIXTURES } from "../../packages/core/src/hardware.fixtures";
// localai.js reads the setup rules and the card detection from vendor/, a build of these two files
// (npm run build:welcome) that is the packaging input. The test never writes there: it hands
// localai.js the sources themselves, as main.seams.test.ts does.
import * as profileRules from "../../packages/core/src/profile";
import * as hardwareRules from "../../packages/core/src/hardware";

const require = createRequire(import.meta.url);

/** localai.js, loaded with its two vendor/ bundles replaced by the core sources. */
function loadLocalai() {
  const file = path.resolve(__dirname, "localai.js");
  const own = createRequire(file);
  const vendor: Record<string, unknown> = { "./vendor/profile": profileRules, "./vendor/hardware": hardwareRules };
  const mod = { exports: {} as Record<string, unknown> };
  const wrapped = runInThisContext(Module.wrap(fs.readFileSync(file, "utf8")), { filename: file });
  wrapped.call(mod.exports, mod.exports, (id: string) => (id in vendor ? vendor[id] : own(id)), mod, file, path.dirname(file));
  return mod.exports;
}

type Hw = { ramGb: number; cores: number; gpuKind: string; vramGb: number | null; gpuOllama?: boolean; freeGb: number };
const { CATALOG, hardwareScan, profileOf, recommend } = loadLocalai() as {
  CATALOG: Record<string, unknown>;
  hardwareScan: (o?: { refresh?: boolean; run?: ProbeRunner }) => Promise<Hw & { gpu: string }>;
  profileOf: (hw: Hw) => string;
  recommend: (hw: Hw & { gpuClass?: string }) => { profile: string; models: string[] };
};

// every combination the rules distinguish, and the values just around each threshold
const RAM = [4, 6, 8, 11, 12, 15, 16, 32, 64];
const CORES = [2, 4, 5, 6, 8, 22];
const GPUS: Array<{ kind: MachineInfo["gpu"]["kind"]; vramGb: number | null; ollama?: boolean }> = [
  { kind: "none", vramGb: null },
  { kind: "integrated", vramGb: 0.5 },
  { kind: "discrete", vramGb: 3.9 },
  { kind: "discrete", vramGb: 4 },
  { kind: "discrete", vramGb: 7.9 },
  { kind: "discrete", vramGb: 8 },
  { kind: "discrete", vramGb: 8, ollama: false },
  { kind: "discrete", vramGb: 12 },
  { kind: "discrete", vramGb: 24 },
  { kind: "unified", vramGb: 16 },
];
const DISK = [-1, 15, 16, 500];
const machineOf = (ramGb: number, cores: number, gpu: (typeof GPUS)[number], freeGb: number): MachineInfo => ({ ramGb, cores, gpu, freeDiskGb: freeGb < 0 ? null : freeGb });
const hwOf = (ramGb: number, cores: number, gpu: (typeof GPUS)[number], freeGb: number): Hw => ({ ramGb, cores, gpuKind: gpu.kind, vramGb: gpu.vramGb, gpuOllama: gpu.ollama, freeGb });

describe("first-start recommendation follows the setup profiles", () => {
  it("localai.js picks the same profile as packages/core/src/profile.ts on every machine", () => {
    let n = 0;
    for (const ramGb of RAM)
      for (const cores of CORES)
        for (const gpu of GPUS)
          for (const freeGb of DISK) {
            const core = recommendProfile(machineOf(ramGb, cores, gpu, freeGb)).profile;
            expect(profileOf(hwOf(ramGb, cores, gpu, freeGb)), JSON.stringify({ ramGb, cores, gpu, freeGb })).toBe(core);
            n++;
          }
    expect(n).toBe(RAM.length * CORES.length * GPUS.length * DISK.length);
  });

  // Review T2 finding 2: the screen helper downloaded must be the one OK Filow calls (setupChoices)
  it("downloads exactly the profile's models (no other screen helper), plus Whisper and the slide model, at every free disk size", () => {
    for (const ramGb of RAM)
      for (const cores of CORES)
        for (const gpu of GPUS)
          for (const free of [-1, 3, 5, 6, 15, 16, 17, 20, 500]) {
          const hw = hwOf(ramGb, cores, gpu, free);
          const machine = machineOf(ramGb, cores, gpu, free);
          const rec = recommend(hw);
          const c = setupChoices(recommendProfile(machine).profile, machine);
          const want = c.models.filter((m) => m.runtime !== "browser").map((m) => m.name);
          const got = rec.models.filter((m) => !m.startsWith("whisper-") && !m.startsWith("gemma4:"));
          expect(got.sort(), JSON.stringify(hw)).toEqual(want.sort());
          if (c.screenHelper.model) expect(rec.models).toContain(c.screenHelper.model);
          // and what it downloads fits, with 4 GB left free (nothing is installed on these machines)
          const ollamaGb = rec.models.reduce((s, m) => s + ((CATALOG[m] as { ollama: boolean; dl: number }).ollama ? (CATALOG[m] as { dl: number }).dl : 0), 0);
          if (free >= 0 && ollamaGb > 0) expect(ollamaGb + 4, JSON.stringify(hw)).toBeLessThanOrEqual(free);
          for (const m of rec.models) expect(CATALOG, m).toHaveProperty([m]);
        }
  });

  it("never Clef below Best quality; nothing for OK Filow under 6 GB", () => {
    const cases: Array<[Hw, string]> = [
      [{ ramGb: 8, cores: 4, gpuKind: "none", vramGb: null, freeGb: 100 }, "lite"],
      [{ ramGb: 16, cores: 8, gpuKind: "integrated", vramGb: null, freeGb: 100 }, "standard"],
      [{ ramGb: 32, cores: 22, gpuKind: "discrete", vramGb: 8, freeGb: 400 }, "advanced"],
    ];
    for (const [hw, profile] of cases) {
      const rec = recommend(hw);
      expect(rec.profile).toBe(profile);
      expect(rec.models.includes("clef-flash")).toBe(profile === "advanced");
    }
    expect(recommend({ ramGb: 4, cores: 2, gpuKind: "none", vramGb: null, freeGb: 100 }).models).toEqual(["nemotron-streaming", "whisper-base"]);
    expect(recommend({ ramGb: 6, cores: 2, gpuKind: "none", vramGb: null, freeGb: 100 }).models).toEqual(["nemotron-streaming", "whisper-base", "lfm3-vl"]);
  });
});

// Review T2 spec gap: the speech threads a setup reports are the ones stt.js runs
describe("speech threads", () => {
  it("stt.js uses the setup's rule for every core count", () => {
    const os = require("node:os") as typeof import("node:os");
    const { SttSession } = require("./stt.js") as { SttSession: { prototype: { threads(): number } } };
    const real = os.cpus;
    try {
      for (let cores = 1; cores <= 32; cores++) {
        os.cpus = () => real().slice(0, 1).concat(Array(cores - 1).fill(real()[0]));
        expect(SttSession.prototype.threads.call({}), String(cores)).toBe(sttThreads(cores));
        expect(setupChoices("lite", { ramGb: 8, cores, gpu: { kind: "none", vramGb: null } }).stt.threads).toBe(sttThreads(cores));
      }
    } finally {
      os.cpus = real;
    }
  });
});

// Review T2 findings 4 and 6: the desktop scan runs the shared detection, asynchronously
describe("hardware scan", () => {
  it("detects every fixture card as the core (and the server) does", async () => {
    for (const f of GPU_FIXTURES) {
      const hw = await hardwareScan({ refresh: true, run: fixtureRunner(f) });
      if (process.platform !== "win32" && f.nvidia === "") continue; // the Windows adapter script only runs on Windows
      expect({ kind: hw.gpuKind, vramGb: hw.vramGb, ollama: hw.gpuOllama }, f.label).toEqual(f.want);
    }
  });

  it("does not block: it returns a promise at once, and one scan serves the session", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow: ProbeRunner = async () => {
      calls++;
      await gate;
      return "";
    };
    // Not a stopwatch (it failed at 95 ms under a loaded machine): the call must hand back a promise that
    // is still pending while the probe is held, i.e. it returned without waiting for the scan.
    const a = hardwareScan({ refresh: true, run: slow });
    const b = hardwareScan();
    const PENDING = Symbol("pending");
    expect(await Promise.race([a.then(() => "settled"), new Promise((r) => setTimeout(() => r(PENDING), 0))])).toBe(PENDING);
    expect(a).toBe(b);
    release();
    await a;
    expect(calls).toBeGreaterThan(0);
    const before = calls;
    await hardwareScan();
    expect(calls).toBe(before);
  });
});
