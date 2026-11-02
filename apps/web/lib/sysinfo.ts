// Live machine resources for the Settings dashboard and the "auto" start mode: CPU load, RAM,
// GPU memory (nvidia-smi where present, Windows GPU performance counters otherwise, unified memory
// on Apple silicon) and which Ollama models are loaded and where they sit (VRAM vs RAM).
import os from "node:os";
import { execFile } from "node:child_process";

export type GpuInfo = {
  name: string;
  /** "discrete" has its own VRAM; "integrated"/"unified" share system RAM. */
  kind: "discrete" | "integrated" | "unified" | "none";
  vramTotalGb: number | null;
  vramUsedGb: number | null;
  /** Memory the GPU borrows from system RAM (Windows "Shared Usage"). */
  sharedUsedGb: number | null;
  utilPct: number | null;
  source: "nvidia-smi" | "windows-counters" | "apple" | "none";
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

// ---- GPU
let gpuCache: { at: number; info: GpuInfo } | null = null;
const NONE: GpuInfo = { name: "", kind: "none", vramTotalGb: null, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "none" };

async function nvidiaSmi(): Promise<GpuInfo | null> {
  const out = await run("nvidia-smi", ["--query-gpu=name,memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits"], 3000);
  const line = out.split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const [name, used, total, util] = line.split(",").map((s) => s.trim());
  return { name, kind: "discrete", vramUsedGb: Math.round((Number(used) / 1024) * 10) / 10, vramTotalGb: Math.round((Number(total) / 1024) * 10) / 10, sharedUsedGb: null, utilPct: Number(util) || 0, source: "nvidia-smi" };
}

const WIN_PS = `
$ErrorActionPreference='SilentlyContinue'
$cls='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'
$adapter=Get-ChildItem $cls | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DriverDesc -and $_.DriverDesc -notmatch 'Remote|Basic|Virtual' } | Select-Object -First 1
$name=$adapter.DriverDesc
$total=$adapter.'HardwareInformation.qwMemorySize'
if (-not $total) { $total=(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Remote|Basic|Virtual' } | Measure-Object AdapterRAM -Maximum).Maximum }
$ded=((Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage').CounterSamples | Measure-Object CookedValue -Sum).Sum
$sh=((Get-Counter '\\GPU Adapter Memory(*)\\Shared Usage').CounterSamples | Measure-Object CookedValue -Sum).Sum
$util=((Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage').CounterSamples | Measure-Object CookedValue -Sum).Sum
[pscustomobject]@{ name=$name; total=[double]$total; dedicated=[double]$ded; shared=[double]$sh; util=[double]$util } | ConvertTo-Json -Compress
`;

async function windowsCounters(): Promise<GpuInfo | null> {
  const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_PS], 8000);
  try {
    const j = JSON.parse(out.trim()) as { name?: string; total?: number; dedicated?: number; shared?: number; util?: number };
    if (!j.name) return null;
    const integrated = /arc|iris|uhd|vega|radeon\(tm\) graphics|intel/i.test(j.name) && !(j.total && j.total > 3 * 1024 ** 3);
    return {
      name: j.name,
      kind: integrated ? "integrated" : "discrete",
      vramTotalGb: j.total ? gb(j.total) : null,
      vramUsedGb: j.dedicated ? gb(j.dedicated) : 0,
      sharedUsedGb: j.shared ? gb(j.shared) : 0,
      utilPct: typeof j.util === "number" ? Math.min(100, Math.round(j.util)) : null,
      source: "windows-counters",
    };
  } catch {
    return null;
  }
}

export async function gpuInfo(): Promise<GpuInfo> {
  if (gpuCache && Date.now() - gpuCache.at < 2500) return gpuCache.info;
  let info: GpuInfo | null = await nvidiaSmi();
  if (!info && process.platform === "win32") info = await windowsCounters();
  if (!info && process.platform === "darwin" && /apple/i.test(os.cpus()[0]?.model || "")) {
    info = { name: `${os.cpus()[0].model} (unified memory)`, kind: "unified", vramTotalGb: gb(os.totalmem()), vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "apple" };
  }
  gpuCache = { at: Date.now(), info: info ?? NONE };
  return gpuCache.info;
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
 * Should "auto" pick the local models on this machine? Yes when the GPU can hold the decision model
 * (6 GB) or there is enough system RAM for it (16 GB); the reason is shown to the user.
 */
export function localAdvice(gpu: GpuInfo, ramTotalGb: number): { local: boolean; reason: "gpu" | "ram" | "none" } {
  if (gpu.kind === "discrete" && (gpu.vramTotalGb ?? 0) >= 6) return { local: true, reason: "gpu" };
  if (gpu.kind === "unified" && ramTotalGb >= 16) return { local: true, reason: "gpu" };
  if (ramTotalGb >= 16) return { local: true, reason: "ram" };
  return { local: false, reason: "none" };
}
