// Browser side of the gate: one embedding worker per page, loaded on demand, and the point
// vectors cached in localStorage under the gate cache key (model + prep version + language +
// point texts), so a script that was seen before costs nothing to prepare again.
import { GATE_MODEL, createDownloadProgress, embedPoints, gateCacheKey, type Bullet, type Embedder, type PointVectors } from "@filow/core";

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
/** The whole model's percent (all its files' bytes together, never going down), or null before any size is known. */
export type GateProgress = { percent: number | null };
let onProgress: ((p: GateProgress) => void) | null = null;

export function gateAvailable(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

/** Loads the model (first time: a download of ~120 MB, then the browser cache). Resolves when ready. */
export function loadGate(progress?: (p: GateProgress) => void): Promise<void> {
  if (!gateAvailable()) return Promise.reject(new Error("no worker support"));
  if (progress) onProgress = progress;
  if (ready) return ready;
  worker = new Worker(new URL("./embed.worker.ts", import.meta.url), { type: "module" });
  const total = createDownloadProgress();
  ready = new Promise<void>((resolve, reject) => {
    worker!.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: string; id?: number; dims?: number; data?: Float32Array; message?: string; status?: string; file?: string; loaded?: number; total?: number };
      if (m.type === "ready") resolve();
      else if (m.type === "progress") onProgress?.({ percent: total.update(m) });
      else if (m.type === "vectors" && m.id !== undefined && m.data && m.dims) {
        const d = m.dims;
        const n = m.data.length / d;
        pending.get(m.id)?.resolve(Array.from({ length: n }, (_, i) => m.data!.slice(i * d, (i + 1) * d)));
        pending.delete(m.id);
      } else if (m.type === "error") {
        if (m.id !== undefined) {
          pending.get(m.id)?.reject(new Error(m.message));
          pending.delete(m.id);
        } else reject(new Error(m.message));
      }
    };
    worker!.onerror = (e) => {
      const err = new Error(e.message);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker?.terminate();
      worker = null;
      ready = null;
      reject(err);
    };
    worker!.postMessage({ type: "load", model: GATE_MODEL });
  });
  ready.catch(() => {
    worker?.terminate();
    worker = null;
    ready = null;
  });
  return ready;
}

/** The embedder handed to gatedDecide; it waits for the model when it is still loading. */
export const browserEmbed: Embedder = async (texts) => {
  if (!texts.length) return [];
  await loadGate();
  const id = ++seq;
  return new Promise<Float32Array[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ type: "embed", id, texts });
  });
};

const CACHE_PREFIX = "gate:points:";

function readCache(key: string): PointVectors | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const j = JSON.parse(raw) as { ids: string[]; vectors: number[][] };
    return { key, ids: j.ids, vectors: j.vectors.map((v) => Float32Array.from(v)) };
  } catch {
    return null;
  }
}

function writeCache(pv: PointVectors): void {
  try {
    // keep only a handful of scripts: the newest wins
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX));
    for (const k of keys.slice(0, Math.max(0, keys.length - 5))) localStorage.removeItem(k);
    localStorage.setItem(CACHE_PREFIX + pv.key, JSON.stringify({ ids: pv.ids, vectors: pv.vectors.map((v) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4)) }));
  } catch {
    /* quota or private mode: the vectors are simply recomputed next time */
  }
}

/** Point vectors for a script, from the cache when the same points were prepared before. */
export async function preparePoints(bullets: Bullet[], language: string): Promise<PointVectors> {
  const key = gateCacheKey(bullets, language);
  const cached = readCache(key);
  if (cached && cached.ids.length === bullets.length) return cached;
  const pv = await embedPoints(browserEmbed, bullets, language);
  writeCache(pv);
  return pv;
}
