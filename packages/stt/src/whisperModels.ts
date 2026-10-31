// Whisper models that run in the browser / Electron through transformers.js.
export type WhisperModel = { id: string; label: string; downloadMb: number; note: string };

export const WHISPER_MODELS: WhisperModel[] = [
  { id: "onnx-community/whisper-base", label: "Whisper base", downloadMb: 150, note: "fastest, fine for clear speech" },
  { id: "onnx-community/whisper-small", label: "Whisper small", downloadMb: 500, note: "better accuracy, needs a decent GPU or patience on CPU" },
];

export const DEFAULT_WHISPER_MODEL = WHISPER_MODELS[0].id;
const KEY = "whisper:model";

export function selectedWhisperModel(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_WHISPER_MODEL;
  } catch {
    return DEFAULT_WHISPER_MODEL;
  }
}
export function setSelectedWhisperModel(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export type WhisperProgress = { status: string; file?: string; progress?: number };

/** Creates the recognition worker (bundled by Next / Vite). */
export function createWhisperWorker(): Worker {
  return new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
}

/** Download (or warm from cache) a model and report progress; resolves with the device used. */
export function preloadWhisper(model: string, onProgress: (p: WhisperProgress) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = createWhisperWorker();
    w.onmessage = (ev: MessageEvent<{ type: string; status?: string; file?: string; progress?: number; device?: string; message?: string }>) => {
      const m = ev.data;
      if (m.type === "progress") onProgress({ status: m.status ?? "", file: m.file, progress: m.progress });
      if (m.type === "ready") {
        w.terminate();
        resolve(m.device ?? "wasm");
      }
      if (m.type === "error") {
        w.terminate();
        reject(new Error(m.message));
      }
    };
    w.postMessage({ type: "load", model });
  });
}

/** Whether the model files are already in the browser cache (no download needed). */
export async function whisperCached(model: string): Promise<boolean> {
  try {
    const keys = await caches.keys();
    for (const k of keys) {
      const c = await caches.open(k);
      const reqs = await c.keys();
      if (reqs.some((r) => r.url.includes(model))) return true;
    }
  } catch {
    /* no Cache API */
  }
  return false;
}
