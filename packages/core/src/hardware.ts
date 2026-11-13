// Graphics card detection shared by the desktop app (apps/desktop/localai.js, through its vendor
// bundle) and the web server (apps/web/lib/sysinfo.ts): the same probes, parsed and classified the
// same way, so both sides give a machine the same setup profile (packages/core/src/profile.ts).
// No Node imports: the caller hands in a runner for the probe commands, so this stays testable.

export type GpuKind = "discrete" | "integrated" | "unified" | "none";

export type DetectedGpu = {
  name: string;
  /** "discrete" has its own memory; "integrated" and "unified" share the system's. */
  kind: GpuKind;
  /** the card's own memory, GB (unified: the system memory); null when it has none or it is unknown */
  vramGb: number | null;
  /**
   * Ollama runs models on this card: NVIDIA (CUDA), Apple silicon (Metal), and the AMD Radeon cards
   * on Ollama's ROCm list. Anything else (Intel Arc, older Radeons, built-in graphics) runs the
   * models on the processor, so it must not count as a graphics card for the setup profiles.
   */
  ollama: boolean;
  source: "nvidia-smi" | "windows" | "apple" | "lspci" | "none";
};

/** Runs a command and resolves its standard output, or "" when it fails or times out. Never rejects. */
export type ProbeRunner = (cmd: string, args: string[], timeoutMs: number) => Promise<string>;

export const NO_GPU: DetectedGpu = { name: "", kind: "none", vramGb: null, ollama: false, source: "none" };

/** The machine a QA run pretends to be (FILOW_QA_HARDWARE): memory, logical processors and no graphics card. */
export type QaHardware = { ramGb: number; cores: number; gpu: DetectedGpu };

/**
 * QA builds only (the shells drop the variable otherwise): `ramGb=16,cores=8,gpu=none`, so every
 * hardware read sees that laptop. Only `gpu=none` is accepted; anything else is null (the real PC).
 */
export function parseQaHardware(value?: string): QaHardware | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const fields = new Map<string, string>();
  for (const part of value.split(",")) {
    const m = /^\s*([a-zA-Z]+)\s*=\s*([^\s,]+)\s*$/.exec(part);
    if (!m || fields.has(m[1])) return null;
    fields.set(m[1], m[2]);
  }
  if (fields.size !== 3 || fields.get("gpu") !== "none") return null;
  const int = (v: string | undefined) => (v !== undefined && /^\d{1,4}$/.test(v) ? Number(v) : NaN);
  const ramGb = int(fields.get("ramGb"));
  const cores = int(fields.get("cores"));
  if (!(ramGb >= 1 && ramGb <= 4096) || !(cores >= 1 && cores <= 1024)) return null;
  return { ramGb, cores, gpu: NO_GPU };
}

const gb1 = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;

export const NVIDIA_SMI_ARGS = ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"];

/** The card with the most memory in `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` (MiB). */
export function parseNvidiaSmi(out: string): { name: string; vramGb: number } | null {
  let best: { name: string; vramGb: number } | null = null;
  for (const line of out.split(/\r?\n/).filter((l) => l.trim())) {
    const parts = line.split(",").map((s) => s.trim());
    const mib = Number(parts[parts.length - 1]);
    if (parts.length < 2 || !Number.isFinite(mib) || mib <= 0) continue;
    const card = { name: parts.slice(0, -1).join(","), vramGb: Math.round((mib / 1024) * 10) / 10 };
    if (!best || card.vramGb > best.vramGb) best = card;
  }
  return best;
}

/**
 * Windows: the display adapters present (Win32_VideoController), each with its memory from the
 * driver's registry entry (64-bit qwMemorySize; AdapterRAM is 32-bit and stops at 4 GB).
 */
export const WIN_ADAPTERS_PS = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$mem=@{}",
  "Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' | ForEach-Object { $p=Get-ItemProperty $_.PSPath; if ($p.DriverDesc) { $q=[double]$p.'HardwareInformation.qwMemorySize'; if ($q -gt [double]$mem[$p.DriverDesc]) { $mem[$p.DriverDesc]=$q } } }",
  "$list=@(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Remote|Basic|Virtual|Mirror' } | ForEach-Object { $b=[double]$mem[$_.Name]; if (-not $b) { $b=[double]$_.AdapterRAM }; [pscustomobject]@{ name=[string]$_.Name; bytes=$b } })",
  "ConvertTo-Json -InputObject $list -Compress",
].join("\n");

export function parseWinAdapters(out: string): Array<{ name: string; memGb: number | null }> {
  try {
    const j = JSON.parse(out.trim()) as unknown;
    const list = (Array.isArray(j) ? j : [j]) as Array<{ name?: unknown; bytes?: unknown }>;
    return list
      .filter((a) => a && typeof a.name === "string" && a.name.trim())
      .map((a) => ({ name: String(a.name).trim(), memGb: typeof a.bytes === "number" && a.bytes > 0 ? gb1(a.bytes) : null }));
  } catch {
    return [];
  }
}

// Built-in graphics, named the way Windows and lspci name them. Checked before the discrete
// patterns: an AMD APU can be given 8 GB of "dedicated" memory in the BIOS and still be built in.
const INTEGRATED = [
  /\bintel\b.*\b(uhd|hd|iris)\b/i, // Intel UHD, HD, Iris Xe
  /\bintel\(r\) graphics\b/i, // Core Ultra 200
  /\barc(\(tm\))? graphics\b/i, // Core Ultra built-in Arc
  /\barc(\(tm\))? \d{3}[vt]\b/i, // Arc 130V, 140V, 140T (built in)
  /radeon(\(tm\))? graphics\b/i, // AMD APU "Radeon(TM) Graphics"
  /radeon(\(tm\))? \d{3,4}[ms]\b/i, // Radeon 680M, 780M, 890M, 8060S
  /\bvega \d+ graphics\b/i, // Vega 8 Graphics (APU)
  /\b(adreno|mali|powervr|videocore)\b/i,
];
const DISCRETE = [/\b(nvidia|geforce|quadro|tesla)\b|\b[rg]tx\b/i, /\bradeon\b.*\b(rx|pro|vii)\b|\bfirepro\b/i, /\barc(\(tm\))? [ab]\d{3}\b/i];
// Ollama's GPU support: NVIDIA (CUDA) and these AMD Radeon cards (ROCm); Intel Arc is not on it.
// (laptop Radeons are not on the list and are left out: a lighter setup is the safe error)
const OLLAMA_AMD = /\brx\s*(6[89]\d0|7[6-9]\d0|9\d{3})\b|\bradeon pro w(6[89]\d0|7\d{3})\b|\bradeon(\(tm\))? vii\b|\brx vega (56|64)\b/i;
const NVIDIA = /\b(nvidia|geforce|quadro|tesla)\b|\b[rg]tx\b/i;

/** One display adapter by its name and memory (GB, null = unknown). NVIDIA cards come from nvidia-smi. */
export function classifyAdapter(name: string, memGb: number | null, source: DetectedGpu["source"] = "windows"): DetectedGpu {
  const n = name.trim();
  if (!n) return NO_GPU;
  if (INTEGRATED.some((r) => r.test(n))) return { name: n, kind: "integrated", vramGb: null, ollama: false, source };
  const discrete = DISCRETE.some((r) => r.test(n)) || (memGb !== null && memGb >= 2);
  if (!discrete) return { name: n, kind: "integrated", vramGb: null, ollama: false, source };
  return { name: n, kind: "discrete", vramGb: memGb, ollama: NVIDIA.test(n) || OLLAMA_AMD.test(n), source };
}

/** The adapter that matters when there are several: one Ollama can use, then the most memory. */
export function pickAdapter(list: DetectedGpu[]): DetectedGpu {
  const score = (g: DetectedGpu) => (g.kind === "discrete" ? 2 : g.kind === "integrated" ? 1 : 0) * 1e6 + (g.ollama ? 1e5 : 0) + (g.vramGb ?? 0);
  return [...list].sort((a, b) => score(b) - score(a))[0] ?? NO_GPU;
}

export type ProbeEnv = { platform: string; cpuModel: string; totalMemBytes: number };

/** The machine's graphics card, the same way on the desktop and on the server. */
export async function detectGpu(run: ProbeRunner, env: ProbeEnv): Promise<DetectedGpu> {
  if (env.platform === "darwin") {
    // Apple silicon: the GPU shares the whole memory and Ollama runs on it (Metal)
    return /apple/i.test(env.cpuModel) ? { name: `${env.cpuModel} (unified memory)`, kind: "unified", vramGb: gb1(env.totalMemBytes), ollama: true, source: "apple" } : NO_GPU;
  }
  // An NVIDIA card answers nvidia-smi even when Windows lists the built-in graphics first (laptops with both)
  const nv = parseNvidiaSmi(await run("nvidia-smi", NVIDIA_SMI_ARGS, 3000));
  if (nv) return { name: nv.name, kind: "discrete", vramGb: nv.vramGb, ollama: true, source: "nvidia-smi" };
  if (env.platform === "win32") {
    const list = parseWinAdapters(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_ADAPTERS_PS], 8000));
    return pickAdapter(list.map((a) => classifyAdapter(a.name, a.memGb, "windows")));
  }
  const out = await run("sh", ["-c", "lspci 2>/dev/null | grep -iE 'vga|3d' | cut -d: -f3"], 4000);
  return pickAdapter(out.split(/\r?\n/).filter((l) => l.trim()).map((l) => classifyAdapter(l, null, "lspci")));
}

/**
 * Where Ollama keeps its models: OLLAMA_MODELS when set, else ~/.ollama/models (Windows, macOS, and
 * a Linux user install). Free disk for the setup is measured there, not on the home folder.
 */
export function ollamaModelsDir(env: Record<string, string | undefined>, home: string, sep = "/"): string {
  const set = env.OLLAMA_MODELS?.trim();
  return set || [home.replace(/[\\/]+$/, ""), ".ollama", "models"].join(sep);
}

/**
 * Free space (GB) on the drive that holds `dir`: the folder may not exist yet (Ollama not installed),
 * so the nearest existing parent is measured. null when nothing up the path can be measured.
 */
export function freeGbAt(dir: string, statfs: (p: string) => { bavail: number | bigint; bsize: number | bigint }, parent: (p: string) => string): number | null {
  let p = dir;
  for (let i = 0; i < 64; i++) {
    try {
      const s = statfs(p);
      return Math.round((Number(s.bavail) * Number(s.bsize)) / 1024 ** 3);
    } catch {
      const up = parent(p);
      if (!up || up === p) return null;
      p = up;
    }
  }
  return null;
}
