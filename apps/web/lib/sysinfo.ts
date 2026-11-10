// Live machine resources for the Settings dashboard and the "auto" start mode: CPU load, RAM,
// GPU memory (nvidia-smi where present, Windows GPU performance counters otherwise, unified memory
// on Apple silicon) and which Ollama models are loaded and where they sit (VRAM vs RAM).
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import path from "node:path";
import { detectGpu, freeGbAt, ollamaModelsDir, type DetectedGpu, type MachineInfo, type ProbeRunner } from "@filow/core";

export type GpuInfo = {
  name: string;
  /** "discrete" has its own VRAM; "integrated"/"unified" share system RAM. */
  kind: "discrete" | "integrated" | "unified" | "none";
  vramTotalGb: number | null;
  /** Ollama runs models on this card (core hardware.ts); false = it counts as none for the setup. */
  ollama?: boolean;
  vramUsedGb: number | null;
  /** Memory the GPU borrows from system RAM (Windows "Shared Usage"). */
  sharedUsedGb: number | null;
  utilPct: number | null;
  source: DetectedGpu["source"];
};

export type LoadedModel = { name: string; sizeGb: number; vramGb: number; gpuPct: number; where: "gpu" | "cpu" | "mixed"; expiresAt: string | null };

const run = (cmd: string, args: string[], ms = 4000) =>
  new Promise<string>((resolve) => {
    try {
      execFile(cmd, args, { timeout: ms, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? "" : String(stdout)));
    } catch {
      resolve("");
    }
  });

const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;

// ---- CPU: percentage over the interval since the previous call (first call samples 250 ms).
let cpuPrev: { idle: number; total: number } | null = null;
function cpuSnapshot() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
  }
  return { idle, total };
}
export async function cpuPercent(): Promise<number> {
  if (!cpuPrev) {
    cpuPrev = cpuSnapshot();
    await new Promise((r) => setTimeout(r, 250));
  }
  const now = cpuSnapshot();
  const dIdle = now.idle - cpuPrev.idle;
  const dTotal = now.total - cpuPrev.total;
  cpuPrev = now;
  return dTotal > 0 ? Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100))) : 0;
}

// ---- GPU: which card, detected once per server run with the code the desktop app runs
// (packages/core/src/hardware.ts), so both give the machine the same setup; then its live usage.
let detected: Promise<DetectedGpu> | null = null;
let gpuCache: { at: number; info: GpuInfo } | null = null;

/** The graphics card, the same detection as apps/desktop/localai.js. `runner` is for tests. */
export function detectedGpu(runner: ProbeRunner = run): Promise<DetectedGpu> {
  if (!detected) detected = detectGpu(runner, { platform: process.platform, cpuModel: os.cpus()[0]?.model || "", totalMemBytes: os.totalmem() });
  return detected;
}

/** Tests: forget the detected card and the cached usage. */
export function resetGpuDetection(): void {
  detected = null;
  gpuCache = null;
}

async function nvidiaUsage(): Promise<Pick<GpuInfo, "vramUsedGb" | "utilPct"> | null> {
  const out = await run("nvidia-smi", ["--query-gpu=memory.used,utilization.gpu", "--format=csv,noheader,nounits"], 3000);
  const line = out.split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const [used, util] = line.split(",").map((s) => s.trim());
  return { vramUsedGb: Math.round((Number(used) / 1024) * 10) / 10, utilPct: Number(util) || 0 };
}

const WIN_USAGE_PS = `
$ErrorActionPreference='SilentlyContinue'
$ded=((Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage').CounterSamples | Measure-Object CookedValue -Sum).Sum
$sh=((Get-Counter '\\GPU Adapter Memory(*)\\Shared Usage').CounterSamples | Measure-Object CookedValue -Sum).Sum
$util=((Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage').CounterSamples | Measure-Object CookedValue -Sum).Sum
[pscustomobject]@{ dedicated=[double]$ded; shared=[double]$sh; util=[double]$util } | ConvertTo-Json -Compress
`;

async function windowsUsage(): Promise<Pick<GpuInfo, "vramUsedGb" | "sharedUsedGb" | "utilPct"> | null> {
  const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_USAGE_PS], 8000);
  try {
    const j = JSON.parse(out.trim()) as { dedicated?: number; shared?: number; util?: number };
    return { vramUsedGb: j.dedicated ? gb(j.dedicated) : 0, sharedUsedGb: j.shared ? gb(j.shared) : 0, utilPct: typeof j.util === "number" ? Math.min(100, Math.round(j.util)) : null };
  } catch {
    return null;
  }
}

export async function gpuInfo(): Promise<GpuInfo> {
  if (gpuCache && Date.now() - gpuCache.at < 2500) return gpuCache.info;
  const g = await detectedGpu();
  const info: GpuInfo = { name: g.name, kind: g.kind, vramTotalGb: g.vramGb, ollama: g.ollama, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: g.source };
  if (g.source === "nvidia-smi") Object.assign(info, await nvidiaUsage());
  else if (process.platform === "win32" && g.kind !== "none") Object.assign(info, await windowsUsage());
  gpuCache = { at: Date.now(), info };
  return info;
}

// ---- Ollama: what is loaded right now and how much of it sits in VRAM
export async function loadedModels(ollamaUrl: string): Promise<LoadedModel[]> {
  try {
    const j = (await fetch(`${ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json())) as {
      models?: Array<{ name: string; size: number; size_vram: number; expires_at?: string }>;
    };
    return (j.models ?? []).map((m) => {
      const pct = m.size > 0 ? Math.round((m.size_vram / m.size) * 100) : 0;
      return { name: m.name, sizeGb: gb(m.size), vramGb: gb(m.size_vram), gpuPct: pct, where: pct >= 95 ? "gpu" : pct <= 5 ? "cpu" : "mixed", expiresAt: m.expires_at ?? null };
    });
  } catch {
    return [];
  }
}

export function ramInfo() {
  return { totalGb: gb(os.totalmem()), usedGb: gb(os.totalmem() - os.freemem()) };
}

/**
 * Free space where Ollama keeps its models (OLLAMA_MODELS, else ~/.ollama/models), GB: the nearest
 * existing folder of that path is measured. null if unknown.
 */
export function freeDiskGb(dir = ollamaModelsDir(process.env, os.homedir(), path.sep)): number | null {
  return freeGbAt(dir, (p) => fs.statfsSync(p), path.dirname);
}

/**
 * The hardware description the setup profiles are chosen from (packages/core/src/profile.ts).
 * RAM is rounded up, so a "16 GB" laptop that reports 15.7 GB counts as 16.
 */
export function machineInfo(gpu: GpuInfo, installed?: string[]): MachineInfo {
  return {
    ramGb: Math.ceil(os.totalmem() / 1024 ** 3),
    cores: os.cpus().length,
    gpu: { kind: gpu.kind, vramGb: gpu.vramTotalGb, ollama: gpu.ollama },
    freeDiskGb: freeDiskGb(),
    installed,
  };
}
