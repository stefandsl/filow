// Web Worker: sentence embeddings for the gate (packages/core/src/gate.ts) with transformers.js.
// Same model as the Node embedder (lib/gate/embedder.ts); cached by the browser after the first
// download, so later takes work offline. Text never leaves the machine.
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = "/ort/";

type In = { type: "load"; model: string } | { type: "embed"; id: number; texts: string[] };
type Out =
  | { type: "progress"; file?: string; progress?: number; status: string }
  | { type: "ready"; model: string; loadMs: number }
  | { type: "vectors"; id: number; dims: number; data: Float32Array }
  | { type: "error"; message: string; id?: number };

let fe: FeatureExtractionPipeline | null = null;
let loading: Promise<void> | null = null;
const post = (m: Out, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

async function load(model: string) {
  if (fe) return;
  if (loading) return loading;
  loading = (async () => {
    const t0 = Date.now();
    fe = (await pipeline("feature-extraction", model, {
      dtype: "q8",
      progress_callback: (p: { status: string; file?: string; progress?: number }) => post({ type: "progress", file: p.file, progress: p.progress, status: p.status }),
    })) as FeatureExtractionPipeline;
    post({ type: "ready", model, loadMs: Date.now() - t0 });
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
    if (!fe) throw new Error("embedding model not loaded");
    const out = (await fe(msg.texts, { pooling: "mean", normalize: true })) as { data: Float32Array; dims: number[] };
    const data = new Float32Array(out.data);
    post({ type: "vectors", id: msg.id, dims: out.dims[1], data }, [data.buffer]);
  } catch (err) {
    post({ type: "error", message: (err as Error).message, id: msg.type === "embed" ? msg.id : undefined });
  }
};
