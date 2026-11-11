// Setup profiles (P3.1): the software picks the setup that fits the machine, so the user never has
// to know what a model is. Pure: a hardware description in, a profile and its concrete choices out.
// The numbers behind each rule were measured on the P3 profile run (docs/gauntlet/BASELINE.md,
// "P3 setup profiles"); the comments name the measurement each threshold rests on.

export type SetupProfileId = "lite" | "standard" | "advanced";
/** What the user asked for: "auto" follows the machine, a profile id pins it. */
export type SetupPreference = "auto" | SetupProfileId;
export const SETUP_PROFILES: SetupProfileId[] = ["lite", "standard", "advanced"];
export const SETUP_PREFERENCES: SetupPreference[] = ["auto", ...SETUP_PROFILES];

export type MachineInfo = {
  /** total memory, GB */
  ramGb: number;
  /** logical processors (os.cpus().length) */
  cores: number;
  /**
   * `ollama` false: a card Ollama cannot run models on (Intel Arc, most Radeons, see hardware.ts);
   * it counts as no graphics card for the profiles. Absent = it can (NVIDIA, Apple).
   */
  gpu: { kind: "discrete" | "integrated" | "unified" | "none"; vramGb: number | null; ollama?: boolean };
  /** free disk where models are stored, GB; null or absent = unknown */
  freeDiskGb?: number | null;
  /**
   * Ollama tags already installed, when known: what is already downloaded needs no free space, so
   * the setup does not change by itself once its own downloads have filled the disk.
   */
  installed?: string[];
};

/** Why the machine got its profile, shown to the user in plain words. */
export type ProfileReason = "gpu" | "unified" | "ram-and-cores" | "small-gpu" | "low-ram" | "few-cores" | "low-disk";

/** Local model the setup needs, with its one-time download. */
/**
 * `use` "take": a local take needs it; "screen": only OK Filow's local answers do; "script": writing
 * a script from slides and translating one on this PC (scriptModel, not part of a profile's `models`).
 */
export type SetupModel = { name: string; downloadGb: number; runtime: "ollama" | "sherpa" | "browser" | "llama"; use: "take" | "screen" | "script" | "dictation" };

/**
 * S1-mini by Superwhisper: writes out English dictation on this PC (apps/desktop/s1-runtime.js, where the
 * file's size and SHA-256 are pinned). Offered with every setup, whatever the tier, and not part of a
 * profile's `models`: only the desktop app can say whether its runtime is in the build and the file here.
 */
export const CLEANUP_MODEL: SetupModel & { bytes: number } = { name: "s1-mini", downloadGb: 0.46, runtime: "llama", use: "dictation", bytes: 484_219_808 };

export type SetupChoices = {
  profile: SetupProfileId;
  /** speech to text: streaming Nemotron on the desktop; the Whisper model only when there is no desktop app */
  stt: { backend: "sherpa"; threads: number; browserWhisper: "onnx-community/whisper-base" | "onnx-community/whisper-small" };
  /** decisions: the on-device matcher (no language model) or Clef Flash through Ollama */
  decision: { provider: "matcher" | "clef-local"; model: string | null };
  /** the embedding gate: on for every profile (the matcher is the gate); narrow false = it only skips calls */
  gate: { on: true; narrow: boolean };
  /**
   * OK Filow on "Answers from: Local". "picture": the model reads the screenshot. "text": no picture
   * is sent; it answers from the question and the text the user selected (pictures are too slow on
   * this machine). "none": no local answer model fits; the user is told, never switched to cloud.
   */
  screenHelper: {
    mode: "picture" | "text" | "none";
    model: string | null;
    /**
     * Best quality on a card under 12 GB: Clef Flash stays loaded (5.2 of 8 GB measured) and picture
     * answers waited 60 to 300 s behind it on the P3 run. The copy says so (owner decision D26 open).
     */
    waitsForDecisions: boolean;
    /**
     * A second, small model that places the points on the screen when the answering model reads the
     * screen well but points badly (Gemma 4 E4B: 2 of 22 points inside the target, with lfm3-vl
     * placing them 20 of 22; both stay loaded together on 8 GB of video memory). Absent: the answering
     * model points itself.
     */
    pointer?: string;
    /** "none" only: what is missing for a local answer model, too little memory or too little free disk */
    lacking?: "memory" | "disk";
  };
  /** everything this setup downloads once */
  models: SetupModel[];
  /** the budget the setup was picked to meet on its target machine (see BASELINE.md) */
  budget: { decisionP95Ms: number; sttRtf: number; screenAnswerS: number | null };
};

export type ResolvedSetup = {
  /** the profile this machine gets on "auto" */
  recommended: SetupProfileId;
  reason: ProfileReason;
  preference: SetupPreference;
  /** the profile in use: the preference, or the recommendation on "auto" */
  active: SetupProfileId;
  choices: SetupChoices;
  /** the user pinned a heavier profile than the machine was given: it may be slow here */
  heavierThanRecommended: boolean;
};

const RANK: Record<SetupProfileId, number> = { lite: 0, standard: 1, advanced: 2 };

/** Left free after the setup's downloads: 3 GB to spare and about 1 GB for Ollama itself. */
export const DOWNLOAD_SPARE_GB = 4;

const SHERPA: SetupModel = { name: "nemotron-streaming", downloadGb: 0.45, runtime: "sherpa", use: "take" };
const MATCHER: SetupModel = { name: "paraphrase-multilingual-MiniLM-L12-v2", downloadGb: 0.12, runtime: "browser", use: "take" };
const LFM: SetupModel = { name: "lfm3-vl", downloadGb: 1.5, runtime: "ollama", use: "screen" };
const CLEF_FLASH: SetupModel = { name: "clef-flash", downloadGb: 11, runtime: "ollama", use: "take" };
const QWEN_2B: SetupModel = { name: "qwen3-vl:2b", downloadGb: 1.9, runtime: "ollama", use: "screen" };

/** "lfm3-vl" is any tag of it ("lfm3-vl:latest"); "qwen3-vl:2b" is that tag only. */
const isInstalled = (name: string, ollama: string[] = []) => ollama.some((i) => i === name || (!name.includes(":") && i.split(":")[0] === name));

/**
 * Free disk (GB) the Ollama models of a list still need, with DOWNLOAD_SPARE_GB left over; 0 when
 * they are all installed. What is already downloaded needs no room, so a setup does not flip to a
 * lighter one after its own downloads filled the disk.
 */
export function diskNeededGb(models: SetupModel[], installed?: string[]): number {
  const missing = models.filter((x) => x.runtime === "ollama" && !isInstalled(x.name, installed)).reduce((s, x) => s + x.downloadGb, 0);
  return missing > 0 ? Math.round((missing + DOWNLOAD_SPARE_GB) * 10) / 10 : 0;
}

const roomFor = (m: MachineInfo, models: SetupModel[]) => m.freeDiskGb === null || m.freeDiskGb === undefined || m.freeDiskGb >= diskNeededGb(models, m.installed);

/**
 * Sizes are what Ollama reports once the model is installed (measured 2026-11-11, docs/TRANSLATE-LOCAL.md).
 * The small models of the setups (lfm3-vl, qwen3-vl:2b) do not translate well enough and are not used for it.
 */
const GEMMA_E2B: SetupModel = { name: "gemma4:e2b", downloadGb: 4.3, runtime: "ollama", use: "script" };
const GEMMA_E4B: SetupModel = { name: "gemma4:e4b", downloadGb: 6.1, runtime: "ollama", use: "script" };
/** Memory from which a script model fits next to the app: Gemma 4 E2B from 8 GB, E4B from 32 GB. */
export const SCRIPT_MODEL_MIN_RAM_GB = 8;

/**
 * The model that writes scripts from slides and translates scripts on this PC, for every setup: the
 * rule the installer and the first start already follow (localai.js recommend). Gemma 4 E4B from
 * 32 GB of memory, E2B from 8 GB; the one already installed wins; a download that would not leave
 * DOWNLOAD_SPARE_GB free is not offered (the big one gives way to the small one first). Null: this
 * PC has too little memory, or too little free disk, for local translation.
 */
export function scriptModel(m: MachineInfo): SetupModel | null {
  const has = (x: SetupModel) => isInstalled(x.name, m.installed);
  if (m.ramGb < SCRIPT_MODEL_MIN_RAM_GB) return null;
  const wanted = m.ramGb >= 32 ? [GEMMA_E4B, GEMMA_E2B] : [GEMMA_E2B];
  return wanted.find(has) ?? wanted.find((x) => roomFor(m, [x])) ?? null;
}

/** Free disk Best quality needs on this machine (its downloads still missing plus the spare), GB. */
export function advancedDiskNeedGb(m: Pick<MachineInfo, "installed">): number {
  return Math.ceil(diskNeededGb([CLEF_FLASH, QWEN_2B], m.installed));
}

/**
 * Video memory Best quality is offered from. 8 GB holds Clef Flash for decisions (p50 0.9 s, p95
 * 1.7 s on an RTX 3070) but not Clef and the screen helper together: picture answers then wait
 * behind Clef (setupChoices sets waitsForDecisions under SHARED_GPU_FREE_GB). Owner decision D26
 * asks whether to raise this to 12; until then 8 stays and the description says what happens.
 */
export const ADVANCED_MIN_VRAM_GB = 8;
/** From this much video memory Clef Flash and the screen helper both stay loaded. */
export const SHARED_GPU_FREE_GB = 12;

/** The graphics card counts for the profiles: Ollama runs models on it (hardware.ts). */
const usableGpu = (m: MachineInfo) => m.gpu.kind === "unified" || (m.gpu.kind === "discrete" && m.gpu.ollama !== false);

/**
 * The profile for a machine.
 * - advanced: a discrete GPU Ollama can use with 8 GB of video memory and 16 GB of RAM, or Apple
 *   unified memory of 32 GB. Clef Flash (9.1B, Q8) split over an 8 GB RTX 3070 answers in p50 0.9 s,
 *   p95 1.7 s; on the CPU alone (Core i9-13900KF) even a 1.7B model takes 6 to 14 s per decision, so
 *   Clef needs the GPU. A card Ollama cannot use (Intel Arc, most Radeons) counts as none.
 * - standard: 12 GB of RAM and 6 logical cores (a typical 16 GB laptop), or a usable discrete GPU
 *   with 4 GB: room for 4 speech threads and for the 1.5 GB picture model next to the app.
 * - lite: everything else (old laptops, 4 to 8 GB, 2 to 4 cores, no graphics card).
 */
export function recommendProfile(m: MachineInfo): { profile: SetupProfileId; reason: ProfileReason } {
  const vram = m.gpu.vramGb ?? 0;
  const usable = usableGpu(m);
  const bigGpu = (usable && m.gpu.kind === "discrete" && vram >= ADVANCED_MIN_VRAM_GB && m.ramGb >= 16) || (m.gpu.kind === "unified" && m.ramGb >= 32);
  // Clef Flash and its screen helper must fit (whatever of them is not downloaded yet), with room to spare
  const diskOk = roomFor(m, [CLEF_FLASH, QWEN_2B]);
  if (bigGpu && diskOk) return { profile: "advanced", reason: m.gpu.kind === "unified" ? "unified" : "gpu" };
  // a big GPU without the disk space for Clef Flash still runs the standard setup well
  if (bigGpu) return { profile: "standard", reason: "low-disk" };
  if (m.ramGb >= 12 && m.cores >= 6) return { profile: "standard", reason: "ram-and-cores" };
  if (usable && m.gpu.kind === "discrete" && vram >= 4 && m.ramGb >= 8) return { profile: "standard", reason: "small-gpu" };
  return { profile: "lite", reason: m.ramGb < 12 ? "low-ram" : "few-cores" };
}

/**
 * Speech threads: the rule apps/desktop/stt.js applies (2 to 4, leaving two cores to the app),
 * measured on the i9 test PC as RTF 0.61 at 1 thread, 0.33 at 2 and 0.22 at 4. stt.js applies it
 * itself; the setup reports it so the numbers on screen and in tests are the ones that run.
 */
export function sttThreads(cores: number): number {
  return Math.max(2, Math.min(4, cores - 2));
}

/** Gemma 4 E4B and lfm3-vl are both on this computer already: Best quality answers with the pair (setupChoices). */
const gemmaPair = (m: MachineInfo) => isInstalled(GEMMA_E4B.name, m.installed) && isInstalled(LFM.name, m.installed);

/** The concrete choices of a profile on a machine. */
export function setupChoices(profile: SetupProfileId, m: MachineInfo): SetupChoices {
  if (profile === "advanced") {
    const shared = m.gpu.kind === "discrete" && (m.gpu.vramGb ?? 0) < SHARED_GPU_FREE_GB;
    return {
      profile,
      stt: { backend: "sherpa", threads: sttThreads(m.cores), browserWhisper: "onnx-community/whisper-small" },
      decision: { provider: "clef-local", model: "clef-flash" },
      // P1: asking Clef about fewer points changes its answers; the gate only skips calls for it
      gate: { on: true, narrow: false },
      // qwen3-vl:2b on the GPU: first word 0.5 s, whole answer 0.7 s with a new screenshot each time
      // (on a card under 12 GB it waits while Clef is loaded: waitsForDecisions)
      // When the user already has Gemma 4 E4B and lfm3-vl (the script model and the Balanced helper), the
      // pair answers instead: measured on an 8 GB RTX 3070, drawings 8 of 8 in 2 to 4 s, ordinary questions
      // 10 of 10 in five languages, points 20 of 22, no model reloaded between questions (v17-parity
      // FINDINGS.md, 2026-11-12). Nothing is downloaded for it: without both, Qwen3-VL 2B stays the helper.
      screenHelper: gemmaPair(m) ? { mode: "picture", model: GEMMA_E4B.name, pointer: LFM.name, waitsForDecisions: shared } : { mode: "picture", model: QWEN_2B.name, waitsForDecisions: shared },
      models: gemmaPair(m) ? [SHERPA, MATCHER, CLEF_FLASH, GEMMA_E4B, LFM] : [SHERPA, MATCHER, CLEF_FLASH, QWEN_2B],
      budget: { decisionP95Ms: 2500, sttRtf: 0.25, screenAnswerS: shared ? 300 : 1 },
    };
  }
  // The small screen helper needs its download to fit; without the room OK Filow has no local
  // answers here and says why (never a download that cannot finish, never a silent switch to cloud).
  const room = roomFor(m, [LFM]);
  if (profile === "standard") {
    return {
      profile,
      stt: { backend: "sherpa", threads: sttThreads(m.cores), browserWhisper: "onnx-community/whisper-base" },
      decision: { provider: "matcher", model: null },
      gate: { on: true, narrow: true },
      // lfm3-vl reads the screenshot: 0.3 s on a GPU, 6 s on this PC's CPU alone (about 10 to 12 s
      // estimated on a typical 16 GB laptop); the fastest picture model measured
      screenHelper: room ? { mode: "picture", model: LFM.name, waitsForDecisions: false } : { mode: "none", model: null, waitsForDecisions: false, lacking: "disk" },
      models: room ? [SHERPA, MATCHER, LFM] : [SHERPA, MATCHER],
      budget: { decisionP95Ms: 100, sttRtf: 0.5, screenAnswerS: room ? 12 : null },
    };
  }
  // lite: pictures take 5 s to the first word on this PC's CPU alone, an estimated 15 to 20 s on an
  // old laptop; the same model answering from text takes 1.7 s here (5 to 7 s estimated there).
  // Under 6 GB of RAM no answer model fits next to the app and the speech model.
  const memory = m.ramGb >= 6;
  const textModel = memory && room;
  return {
    profile,
    stt: { backend: "sherpa", threads: sttThreads(m.cores), browserWhisper: "onnx-community/whisper-base" },
    decision: { provider: "matcher", model: null },
    gate: { on: true, narrow: true },
    screenHelper: textModel ? { mode: "text", model: LFM.name, waitsForDecisions: false } : { mode: "none", model: null, waitsForDecisions: false, lacking: memory ? "disk" : "memory" },
    models: textModel ? [SHERPA, MATCHER, LFM] : [SHERPA, MATCHER],
    budget: { decisionP95Ms: 250, sttRtf: 0.85, screenAnswerS: textModel ? 7 : null },
  };
}

export function isSetupPreference(v: unknown): v is SetupPreference {
  return typeof v === "string" && (SETUP_PREFERENCES as string[]).includes(v);
}

/** The preference applied to the machine: what runs, and whether it is heavier than advised. */
export function resolveSetup(preference: SetupPreference, m: MachineInfo): ResolvedSetup {
  const { profile: recommended, reason } = recommendProfile(m);
  const active = preference === "auto" ? recommended : preference;
  return { recommended, reason, preference, active, choices: setupChoices(active, m), heavierThanRecommended: RANK[active] > RANK[recommended] };
}

/**
 * One-time downloads still needed: the setup's models that are not installed yet. The matcher's small
 * model loads inside the page on first use and is never listed here.
 */
export function missingModels(choices: SetupChoices, installed: { ollama: string[]; sherpa: boolean }): SetupModel[] {
  return choices.models.filter((mm) => (mm.runtime === "ollama" ? !isInstalled(mm.name, installed.ollama) : mm.runtime === "sherpa" ? !installed.sherpa : false));
}
