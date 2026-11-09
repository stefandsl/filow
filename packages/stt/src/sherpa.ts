// Streaming on-device transcription through the desktop shell (sherpa-onnx + Nemotron in a worker
// thread of the Electron main process). The page captures the microphone, ships 16 kHz PCM to the
// shell and gets live partials plus committed sentences back. Desktop app only.
import type { SttBackend, SttHandlers } from "./types";
import { startMic, type MicCapture } from "./mic";

export type SherpaBridge = {
  status: () => Promise<{ model: "ready" | "missing" | "downloading" | "extracting" | "error"; pct: number; error?: string; running: boolean; partial?: number }>;
  download: () => void;
  remove: () => Promise<void>;
  start: (language: string) => Promise<{ loadMs: number }>;
  feed: (samples: Float32Array) => void;
  stop: () => Promise<void>;
  onResult: (fn: (r: { partial: string; committed: string }) => void) => () => void;
  onStatus: (fn: (s: { model: string; pct: number; error?: string; partial?: number }) => void) => () => void;
};

export function sherpaBridge(): SherpaBridge | null {
  const b = (globalThis as { filow?: { stt?: SherpaBridge } }).filow;
  return b?.stt ?? null;
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
    if (st.model !== "ready") throw new Error("the streaming model is not downloaded (Settings > Local models)");
    await bridge.start(this.language && this.language !== "auto" ? this.language : "auto");
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
