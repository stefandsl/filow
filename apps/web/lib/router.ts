// Model router: given what is installed, what the machine can hold and (when asked) one measured
// call per candidate, pick the lowest-latency setup for each task of a take. Pure function
// (buildPlan) so it is unit-tested; the probes and the inventory are gathered by /api/local/plan.
import type { SetupChoices } from "@filow/core";
import { LOCAL_MODELS } from "./localModels";

export type SttChoice = "sherpa" | "elevenlabs" | "openai" | "whisper" | "browser";
export type DecisionChoice = "clef-local" | "openrouter" | "clef-cloudflare" | "matcher";
export type GenerateChoice = "ollama" | "openrouter" | "none";

export type PlanInput = {
  installed: string[]; // Ollama tags present
  ollamaOk: boolean;
  /** `ollama` false: a card Ollama cannot run models on (core hardware.ts), counted as none */
  gpu: { kind: "discrete" | "integrated" | "unified" | "none"; vramTotalGb: number | null; ollama?: boolean };
  ramGb: number;
  keys: { openrouter: boolean; elevenlabs: boolean; openai: boolean; cloudflare: boolean };
  offline: boolean;
  sherpaReady: boolean;
  whisperCached: boolean;
  webSpeech: boolean;
  /** Measured latency of one real decision call, ms; undefined = not probed, null = failed. */
  probes: { clefLocalMs?: number | null; openrouterMs?: number | null };
  /**
   * The setup profile in use (packages/core/src/profile.ts). When given, decisions stay on this
   * computer: the profile's choice, or the on-device matcher while Clef Flash is not installed yet.
   * Absent: the older measured routing below (used only by the explicit "Measure" button).
   */
  setup?: SetupChoices | null;
};

export type Plan = {
  stt: { backend: SttChoice | null; reason: string; expectedLagMs: number | null };
  decision: { provider: DecisionChoice | null; reason: string; measuredMs: number | null };
  generate: { provider: GenerateChoice; model: string | null; reason: string };
  vision: { provider: "openrouter" | "none"; reason: string };
  /** Rough "said to ticked" expectation for confident points: STT lag + decision call + half a tick. */
  expectedTickMs: number | null;
  probes: PlanInput["probes"];
};

const has = (inp: PlanInput, tag: string) => inp.installed.some((n) => n === tag || n.startsWith(`${tag}:`));
const fitsGpu = (inp: PlanInput, gb: number) => (inp.gpu.kind === "discrete" || inp.gpu.kind === "unified") && inp.gpu.ollama !== false && (inp.gpu.vramTotalGb ?? 0) >= gb;
const fitsRam = (inp: PlanInput, gb: number) => inp.ramGb >= gb;

export function buildPlan(inp: PlanInput): Plan {
  // ---- speech-to-text: local streaming first (no network, private, measured ~0.2 RTF), then cloud streaming, then windowed Whisper
  // A setup for this computer keeps the audio here: no cloud and no browser engine (Web Speech sends
  // the audio to the browser maker). Nothing local ready = none, and the page says so and asks.
  let stt: Plan["stt"];
  if (inp.setup) {
    if (inp.sherpaReady) stt = { backend: "sherpa", reason: "streaming-local", expectedLagMs: 1500 };
    else if (inp.whisperCached) stt = { backend: "whisper", reason: "whisper-windowed", expectedLagMs: 4500 };
    else stt = { backend: null, reason: "local-speech-missing", expectedLagMs: null };
  } else if (inp.sherpaReady) stt = { backend: "sherpa", reason: "streaming-local", expectedLagMs: 1500 };
  else if (!inp.offline && inp.keys.elevenlabs) stt = { backend: "elevenlabs", reason: "cloud-streaming", expectedLagMs: 1200 };
  else if (!inp.offline && inp.keys.openai) stt = { backend: "openai", reason: "cloud-streaming", expectedLagMs: 1500 };
  else if (inp.whisperCached) stt = { backend: "whisper", reason: "whisper-windowed", expectedLagMs: 4500 };
  else if (!inp.offline && inp.webSpeech) stt = { backend: "browser", reason: "browser-speech", expectedLagMs: 1500 };
  else stt = { backend: null, reason: "none", expectedLagMs: null };

  // ---- decisions: measured when probed; otherwise what the machine can hold
  const clefInstalled = inp.ollamaOk && (has(inp, "clef-flash") || has(inp, "clef"));
  const clefFits = fitsGpu(inp, 12) || fitsRam(inp, 16);
  const cloudOk = !inp.offline && inp.keys.openrouter;
  const clefMs = inp.probes.clefLocalMs;
  const cloudMs = inp.probes.openrouterMs;
  let decision: Plan["decision"];
  if (inp.setup) {
    if (inp.setup.decision.provider === "matcher") decision = { provider: "matcher", reason: "setup", measuredMs: null };
    else if (clefInstalled) decision = { provider: "clef-local", reason: "setup", measuredMs: typeof clefMs === "number" ? clefMs : null };
    else decision = { provider: "matcher", reason: "clef-missing", measuredMs: null };
  } else if (clefInstalled && typeof clefMs === "number" && clefMs <= 2500 && (!cloudOk || typeof cloudMs !== "number" || clefMs <= cloudMs * 1.2)) {
    decision = { provider: "clef-local", reason: "measured-local-faster", measuredMs: clefMs };
  } else if (cloudOk && typeof cloudMs === "number" && (typeof clefMs !== "number" || clefMs > cloudMs * 1.2 || clefMs > 2500)) {
    decision = { provider: "openrouter", reason: clefInstalled ? "measured-cloud-faster" : "cloud-only", measuredMs: cloudMs };
  } else if (clefInstalled && clefFits && clefMs !== null) {
    decision = { provider: "clef-local", reason: inp.gpu.kind === "discrete" ? "local-on-gpu" : "local-in-ram", measuredMs: null };
  } else if (cloudOk) {
    decision = { provider: "openrouter", reason: clefInstalled ? "local-too-big" : "cloud-only", measuredMs: typeof cloudMs === "number" ? cloudMs : null };
  } else if (clefInstalled) {
    decision = { provider: "clef-local", reason: "local-only", measuredMs: typeof clefMs === "number" ? clefMs : null };
  } else if (!inp.offline && inp.keys.cloudflare) {
    decision = { provider: "clef-cloudflare", reason: "cloud-only", measuredMs: null };
  } else {
    decision = { provider: null, reason: "none", measuredMs: null };
  }

  // ---- script from slides: the best local vision model the machine holds, else cloud
  const gen = [
    { tag: "gemma4:e4b", gpu: 12, ram: 16 },
    { tag: "gemma4:e2b", gpu: 8, ram: 8 },
    { tag: "qwen3-vl:2b", gpu: 4, ram: 6 },
    { tag: "lfm3-vl", gpu: 4, ram: 4 },
  ].find((g) => inp.ollamaOk && has(inp, g.tag) && (fitsGpu(inp, g.gpu) || fitsRam(inp, g.ram)));
  let generate: Plan["generate"];
  if (gen) generate = { provider: "ollama", model: gen.tag, reason: fitsGpu(inp, gen.gpu) ? "local-on-gpu" : "local-in-ram" };
  else if (cloudOk) generate = { provider: "openrouter", model: null, reason: "cloud-only" };
  else generate = { provider: "none", model: null, reason: "none" };

  const vision: Plan["vision"] = cloudOk ? { provider: "openrouter", reason: "cloud-only" } : { provider: "none", reason: "none" };

  // matcher: p95 under 25 ms in the gauntlet (Node); the page adds the tick, so 50 is a fair figure
  const decMs = decision.measuredMs ?? (decision.provider === "matcher" ? 50 : decision.provider === "clef-local" ? (inp.gpu.kind === "discrete" ? 900 : 1500) : decision.provider ? 1500 : null);
  const expectedTickMs = stt.expectedLagMs !== null && decMs !== null ? stt.expectedLagMs + decMs + 250 : null;
  return { stt, decision, generate, vision, expectedTickMs, probes: inp.probes };
}

/** Speech engines that keep the audio on this computer. */
export const LOCAL_STT: readonly SttChoice[] = ["sherpa", "whisper"];
const LOCAL_DECISION: readonly DecisionChoice[] = ["matcher", "clef-local"];

/**
 * What kind of take a plan starts: "local" only when the audio and the decisions both stay on this
 * computer, "cloud" when both go out; anything else (mixed, or an engine missing) is null and the
 * page asks instead of starting, so a take shown as local never sends anything out.
 */
export function takeModeOf(plan: Pick<Plan, "stt" | "decision">): "local" | "cloud" | null {
  const stt = plan.stt.backend;
  const dec = plan.decision.provider;
  if (!stt || !dec) return null;
  const sttLocal = LOCAL_STT.includes(stt);
  const decLocal = LOCAL_DECISION.includes(dec);
  if (sttLocal && decLocal) return "local";
  if (!sttLocal && !decLocal) return "cloud";
  return null;
}

/** Labels for the catalogue entries the plan refers to (for the Settings panel). */
export function modelLabel(tag: string | null): string {
  if (!tag) return "";
  return LOCAL_MODELS.find((m) => m.name === tag)?.label ?? tag;
}
