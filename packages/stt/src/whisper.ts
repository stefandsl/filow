// On-device transcription: Whisper through transformers.js in a Web Worker.
// Audio is captured at 16 kHz, accumulated in ~4 s windows and transcribed
// window by window; each result is committed. Nothing leaves the machine.
import type { SttBackend, SttHandlers } from "./types";
import { startMic, type MicCapture } from "./mic";
import { createWhisperWorker, selectedWhisperModel } from "./whisperModels";

const SAMPLE_RATE = 16000;
const WINDOW_S = 4;
const MIN_RMS = 0.004; // skip silent windows

export class LocalWhisperStt implements SttBackend {
  readonly id = "whisper" as const;
  readonly label = "Whisper on this device";
  private worker: Worker | null = null;
  private mic: MicCapture | null = null;
  private buf: Float32Array[] = [];
  private bufLen = 0;
  private seq = 0;
  private pending = new Map<number, true>();
  private timer: number | null = null;

  constructor(
    private readonly model: string = selectedWhisperModel(),
    private readonly language?: string,
  ) {}

  async start(h: SttHandlers): Promise<void> {
    const worker = createWhisperWorker();
    this.worker = worker;
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<{ type: string; status?: string; progress?: number; message?: string; id?: number; text?: string }>) => {
        const m = ev.data;
        if (m.type === "ready") resolve();
        else if (m.type === "error" && m.id === undefined) reject(new Error(m.message));
      };
      worker.postMessage({ type: "load", model: this.model });
    });
    h.onReady?.();

    worker.onmessage = (ev: MessageEvent<{ type: string; id?: number; text?: string; message?: string }>) => {
      const m = ev.data;
      if (m.type === "result" && m.id !== undefined) {
        this.pending.delete(m.id);
        if (m.text) h.onTranscript({ committed: m.text + " ", partial: "" });
      } else if (m.type === "error") {
        if (m.id !== undefined) this.pending.delete(m.id);
        h.onError(`whisper: ${m.message}`);
      }
    };

    this.mic = await startMic(SAMPLE_RATE, (pcm16) => {
      const i16 = new Int16Array(pcm16);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
      this.buf.push(f32);
      this.bufLen += f32.length;
    }, h.onMicWarning, h.onLog);
    this.timer = window.setInterval(() => this.flush(h), WINDOW_S * 1000);
  }

  private flush(h: SttHandlers) {
    if (!this.worker || this.bufLen === 0) return;
    const audio = new Float32Array(this.bufLen);
    let o = 0;
    for (const c of this.buf) {
      audio.set(c, o);
      o += c.length;
    }
    this.buf = [];
    this.bufLen = 0;
    let sum = 0;
    for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i];
    if (Math.sqrt(sum / audio.length) < MIN_RMS) return;
    // Do not pile up work on slow machines: drop a window if two are still in flight.
    if (this.pending.size >= 2) {
      h.onTranscript({ partial: "(transcription lagging…)" });
      return;
    }
    const id = ++this.seq;
    this.pending.set(id, true);
    h.onTranscript({ partial: "…" });
    this.worker.postMessage({ type: "transcribe", id, audio, language: this.language }, [audio.buffer]);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.mic?.stop();
    this.mic = null;
    this.worker?.terminate();
    this.worker = null;
    this.buf = [];
    this.bufLen = 0;
    this.pending.clear();
  }
}
