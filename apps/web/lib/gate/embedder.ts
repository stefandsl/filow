// Sentence embedder for the gate (packages/core/src/gate.ts), transformers.js on this machine.
// Node: used by the gauntlet runner and the Electron main process. The browser build of the
// same call runs in a Web Worker (apps/web/lib/gate/embed.worker.ts). One model instance per
// process; the first call downloads the quantized model (~120 MB) into the transformers cache.
import { GATE_MODEL, type Embedder } from "@filow/core";

type FeatureExtractor = (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

let loading: Promise<FeatureExtractor> | null = null;

export async function loadEmbedder(model = GATE_MODEL): Promise<{ embed: Embedder; loadMs: number }> {
  const t0 = Date.now();
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      const fe = (await pipeline("feature-extraction", model, { dtype: "q8" })) as unknown as FeatureExtractor;
      return fe;
    })();
  }
  const fe = await loading;
  const loadMs = Date.now() - t0;
  const embed: Embedder = async (texts) => {
    if (!texts.length) return [];
    const out = await fe(texts, { pooling: "mean", normalize: true });
    const [n, d] = out.dims;
    return Array.from({ length: n }, (_, i) => out.data.slice(i * d, (i + 1) * d));
  };
  return { embed, loadMs };
}
