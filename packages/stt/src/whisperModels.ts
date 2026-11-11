// Whisper models that run in the browser / Electron through transformers.js.
export type WhisperModel = { id: string; label: string; downloadMb: number; note: string };

// Sizes are what the worker actually fetches: int8 (q8) on WASM; on WebGPU the fp32 files, about 3-4x larger.
export const WHISPER_MODELS: WhisperModel[] = [
  { id: "onnx-community/whisper-tiny", label: "Whisper tiny", downloadMb: 40, note: "smallest and fastest; rough on Italian" },
  { id: "onnx-community/whisper-base", label: "Whisper base", downloadMb: 80, note: "fast, fine for clear speech" },
  { id: "onnx-community/whisper-small", label: "Whisper small", downloadMb: 250, note: "better accuracy, needs a decent GPU or patience on CPU" },
];

export const DEFAULT_WHISPER_MODEL = WHISPER_MODELS[1].id;
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

/** One file's event; add them up with createDownloadProgress (@filow/core), never show `file` to the user. */
export type WhisperProgress = { status: string; file?: string; progress?: number; loaded?: number; total?: number };

/** Creates the recognition worker (bundled by Next / Vite). */
export function createWhisperWorker(): Worker {
  return new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Download (or warm from cache) a model and report progress; resolves with the device used.
 * `signal` is the user's Stop: the worker and its transfers end at once and the promise rejects with
 * an AbortError. The caller then removes the files that were already complete (removeCachedModel).
 */
export function preloadWhisper(model: string, onProgress: (p: WhisperProgress) => void, signal?: AbortSignal, makeWorker: () => Worker = createWhisperWorker): Promise<string> {
  return new Promise((resolve, reject) => {
    const aborted = () => new DOMException("download stopped by the user", "AbortError");
    if (signal?.aborted) return reject(aborted());
    const w = makeWorker();
    signal?.addEventListener("abort", () => { w.terminate(); reject(aborted()); }, { once: true });
    w.onmessage = (ev: MessageEvent<{ type: string; status?: string; file?: string; progress?: number; loaded?: number; total?: number; device?: string; message?: string }>) => {
      const m = ev.data;
      if (m.type === "progress") onProgress({ status: m.status ?? "", file: m.file, progress: m.progress, loaded: m.loaded, total: m.total });
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

/**
 * Deletes every file of a model that runs inside the app's own page (Whisper, the pre-filter) from the
 * browser cache; returns how many files went and their bytes where the cache knows them. Only entries
 * whose address names this exact model are touched ("…/whisper-base/" never matches "whisper-base.en").
 */
export async function removeCachedModel(model: string, store: Pick<CacheStorage, "keys" | "open"> | undefined = typeof caches === "undefined" ? undefined : caches): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  if (!model || !store) return { files, bytes };
  try {
    for (const k of await store.keys()) {
      const c = await store.open(k);
      for (const r of await c.keys()) {
        if (!r.url.includes(`/${model}/`)) continue;
        const size = Number((await c.match(r))?.headers.get("content-length") ?? 0);
        if (await c.delete(r)) {
          files += 1;
          bytes += Number.isFinite(size) ? size : 0;
        }
      }
    }
  } catch {
    /* no Cache API, or the cache went away meanwhile */
  }
  return { files, bytes };
}
