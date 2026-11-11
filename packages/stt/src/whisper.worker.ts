// Web Worker: on-device speech recognition with Whisper via transformers.js (ONNX, WASM/WebGPU).
// Models are downloaded once from the Hugging Face Hub and cached by the browser (Cache storage),
// so later runs work offline. Audio never leaves the machine.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;
// ONNX runtime wasm files are served by the app itself (apps/web/public/ort), not a CDN.
if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = "/ort/";

type In =
  | { type: "load"; model: string }
  | { type: "transcribe"; id: number; audio: Float32Array; language?: string };
type Out =
  | { type: "progress"; model: string; file?: string; progress?: number; loaded?: number; total?: number; status: string }
  | { type: "ready"; model: string; device: string }
  | { type: "result"; id: number; text: string }
  | { type: "error"; message: string; id?: number };

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadedModel = "";
let loading: Promise<void> | null = null;

const post = (m: Out) => (self as unknown as Worker).postMessage(m);

async function load(model: string) {
  if (asr && loadedModel === model) return;
  if (loading) await loading;
  if (asr && loadedModel === model) return;
  loading = (async () => {
    const hasWebGpu = typeof (self as unknown as { navigator?: { gpu?: unknown } }).navigator?.gpu !== "undefined";
    const device = hasWebGpu ? "webgpu" : "wasm";
    asr = (await pipeline("automatic-speech-recognition", model, {
      device,
      dtype: hasWebGpu ? "fp32" : "q8",
      // loaded/total per file: the page adds them up into one number for the model (issue #4).
      progress_callback: (p: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) =>
        post({ type: "progress", model, file: p.file, progress: p.progress, loaded: p.loaded, total: p.total, status: p.status }),
    })) as AutomaticSpeechRecognitionPipeline;
    loadedModel = model;
    post({ type: "ready", model, device });
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

self.onmessage = async (ev: MessageEvent<In>) => {
  const msg = ev.data;
  try {
    if (msg.type === "load") return await load(msg.model);
    if (msg.type === "transcribe") {
      if (!asr) throw new Error("model not loaded");
      const out = (await asr(msg.audio, {
        language: msg.language,
        task: "transcribe",
        chunk_length_s: 30,
        return_timestamps: false,
      })) as { text?: string } | Array<{ text?: string }>;
      const text = Array.isArray(out) ? out.map((o) => o.text ?? "").join(" ") : (out.text ?? "");
      post({ type: "result", id: msg.id, text: text.trim() });
    }
  } catch (err) {
    post({ type: "error", message: (err as Error).message, id: msg.type === "transcribe" ? msg.id : undefined });
  }
};
