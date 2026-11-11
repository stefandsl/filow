// One steady progress number for a model made of several files (issue #4).
// transformers.js reports each file on its own ("progress decoder_model_merged.onnx 16%", then
// "encoder_model.onnx 27%"), and the files download in parallel, so showing the last event made the
// label jump between files many times a second. Ollama's pull reports each layer (digest) the same way.
// This gives bytes loaded over bytes in total for the whole model, never lower than a number it already
// gave: transformers.js's own "progress_total" when it sends one (it knows every size up front), else the
// sum of the files seen so far (a file whose size becomes known later must not move the bar back).

/** One event: transformers.js ProgressInfo or an Ollama pull line, reduced to what matters here. */
export type DownloadEvent = {
  status?: string;
  /** The file (transformers.js) or the layer digest (Ollama). */
  file?: string;
  loaded?: number;
  total?: number;
};

export type DownloadProgress = {
  /** Takes one event; returns the whole model's percent (0-100), or null while no size is known yet. */
  update(ev: DownloadEvent): number | null;
  /** The last percent given, or null. */
  value(): number | null;
};

export function createDownloadProgress(): DownloadProgress {
  const files = new Map<string, { loaded: number; total: number }>();
  let last: number | null = null;

  let whole: { loaded: number; total: number } | null = null;

  function update(ev: DownloadEvent): number | null {
    const key = ev.file || "";
    const total = Number(ev.total);
    if (ev.status === "progress_total") {
      // transformers.js 4 reads every file's size before the first byte and sends this aggregate: it is
      // the only total that is right from the start (a small file that ends first would read as 100%).
      if (Number.isFinite(total) && total > 0) whole = { total, loaded: Math.min(total, Math.max(0, Number(ev.loaded) || 0)) };
    } else if (key && Number.isFinite(total) && total > 0) {
      const loaded = Math.min(total, Math.max(0, Number(ev.loaded) || 0));
      const prev = files.get(key);
      // A file never goes back (a retried request starts from 0 again: keep what it had reached).
      files.set(key, { total, loaded: Math.max(loaded, prev && prev.total === total ? prev.loaded : 0) });
    } else if (key && ev.status === "done") {
      const f = files.get(key);
      if (f) f.loaded = f.total;
    }
    let sumLoaded = 0;
    let sumTotal = 0;
    if (whole) {
      sumLoaded = whole.loaded;
      sumTotal = whole.total;
    } else {
      for (const f of files.values()) {
        sumLoaded += f.loaded;
        sumTotal += f.total;
      }
    }
    if (sumTotal > 0) {
      const pct = Math.min(100, Math.floor((sumLoaded / sumTotal) * 100));
      last = last === null ? pct : Math.max(last, pct);
    }
    return last;
  }

  return { update, value: () => last };
}
