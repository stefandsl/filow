// On-device transcription through the desktop shell (sherpa-onnx in a worker thread of the Electron
// main process; the model depends on the spoken language, see apps/desktop/stt.js). The page
// captures the microphone, ships 16 kHz PCM to the shell and gets live partials plus committed
// sentences back. Desktop app only.
import type { SttBackend, SttHandlers } from "./types";
import { startMic, type MicCapture } from "./mic";

/** "fallback": the best model for the language is not downloaded; "phrases": the talk is followed phrase by phrase. */
export type SherpaNote = "fallback" | "phrases";

export type SherpaStatus = {
  /** The model Filow wants for following a talk in the chosen language. */
  model: "ready" | "missing" | "downloading" | "extracting" | "error";
  pct: number;
  error?: string;
  running: boolean;
  partial?: number;
  /** The spoken language the shell holds: auto, en, it, ru, ro or ja. */
  language?: string;
  wanted?: string;
  wantedLabel?: string;
  /** False when even the best model for the language only follows a talk phrase by phrase. */
  wantedStreaming?: boolean;
  downloadBytes?: number;
  /** Some model can listen now (possibly a fallback, see notes). */
  usable?: boolean;
  active?: string | null;
  activeLabel?: string | null;
  streaming?: boolean;
  notes?: SherpaNote[];
};

export type SherpaStart = { loadMs: number; model?: string; streaming?: boolean; notes?: SherpaNote[]; language?: string };

export type SherpaBridge = {
  status: () => Promise<SherpaStatus>;
  download: (language?: string) => void;
  /** Stores the spoken language in the shell (desktop builds from 0.9.31) and returns the status for it. */
  setLanguage?: (language: string) => Promise<SherpaStatus>;
  remove: () => Promise<void>;
  start: (language: string) => Promise<SherpaStart>;
  feed: (samples: Float32Array) => void;
  stop: () => Promise<void>;
  onResult: (fn: (r: { partial: string; committed: string }) => void) => () => void;
  onStatus: (fn: (s: SherpaStatus) => void) => () => void;
};

export function sherpaBridge(): SherpaBridge | null {
  const b = (globalThis as { filow?: { stt?: SherpaBridge } }).filow;
  return b?.stt ?? null;
}

/** True when the shell can listen now; older shells only report the one model. */
export function sherpaUsable(s: SherpaStatus): boolean {
  return s.usable ?? s.model === "ready";
}

/**
 * Pure: what the settings page tells the user about the spoken language, as string keys with their
 * values: the model it needs and its size, then plainly what is given up (phrase by phrase, a
 * fallback model, or no model at all yet).
 */
export function sherpaNotes(s: SherpaStatus | null): Array<{ key: "speech.model" | "speech.notePhrases" | "speech.noteFallback" | "speech.noneForLang"; vars?: Record<string, string | number> }> {
  if (!s?.wantedLabel) return [];
  const out: ReturnType<typeof sherpaNotes> = [];
  if (s.model !== "ready") out.push({ key: "speech.model", vars: { model: s.wantedLabel, mb: Math.round((s.downloadBytes ?? 0) / 1e6) } });
  if (s.wantedStreaming === false || s.notes?.includes("phrases")) out.push({ key: "speech.notePhrases" });
  if (s.notes?.includes("fallback") && s.active) out.push({ key: "speech.noteFallback", vars: { active: s.activeLabel ?? s.active, wanted: s.wantedLabel } });
  if (s.usable === false && s.language && s.language !== "auto") out.push({ key: "speech.noneForLang" });
  return out;
}

const SAMPLE_RATE = 16000;

export class SherpaStt implements SttBackend {
  readonly id = "sherpa" as const;
  readonly label = "Streaming on this device (Nemotron)";
  private mic: MicCapture | null = null;
  private off: (() => void) | null = null;
  private stopping: Promise<void> = Promise.resolve();

  constructor(private readonly language?: string) {}

  async start(h: SttHandlers): Promise<void> {
    await this.stopping;
    const bridge = sherpaBridge();
    if (!bridge) throw new Error("streaming transcription needs the desktop app");
    const st = await bridge.status();
    if (!sherpaUsable(st)) throw new Error("the speech model for this language is not downloaded (Settings > Local models)");
    const started = await bridge.start(this.language && this.language !== "auto" ? this.language : "auto");
    if (started?.model) h.onLog?.(`stt: ${started.model}${started.streaming === false ? ", phrase by phrase" : ""}${started.notes?.includes("fallback") ? ", fallback model" : ""}`);
    this.off = bridge.onResult((r) => {
      if (r.committed) h.onTranscript({ committed: r.committed + " ", partial: "" });
      else h.onTranscript({ partial: r.partial });
    });
    h.onReady?.();
    this.mic = await startMic(SAMPLE_RATE, (pcm16) => {
      const i16 = new Int16Array(pcm16);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
      bridge.feed(f32);
    }, h.onMicWarning, h.onLog);
  }

  stop(): void {
    this.mic?.stop();
    this.mic = null;
    const off = this.off;
    this.off = null;
    if (!off) return;
    // Keep receiving the final commitment until the worker has acknowledged its flush.
    this.stopping = Promise.resolve(sherpaBridge()?.stop()).then(off, off);
  }
}
