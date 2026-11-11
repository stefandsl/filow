// Catalog of local models the Settings page can install, with hardware hints.
export type LocalModel = {
  name: string; // Ollama tag, or transformers.js model id for runtime "browser"
  kind: "decision" | "vision" | "stt" | "generate";
  runtime: "ollama" | "browser" | "sherpa";
  downloadGb: number;
  /** Memory the model occupies while loaded: weights + working context. On a GPU this is VRAM, on CPU it is system RAM. */
  loadedGb: number;
  /** Minimum system RAM when it runs on the CPU (model + app headroom). */
  ramGb: number;
  /** Minimum GPU memory (VRAM) for it to run entirely on the graphics card; undefined = runs in the browser worker. */
  vramGb?: number;
  minOllama?: string;
  status: "available" | "planned";
};

export const LOCAL_MODELS: LocalModel[] = [
  {
    name: "nemotron-3.5-asr-streaming-0.6b",
    kind: "stt",
    runtime: "sherpa",
    downloadGb: 0.45,
    loadedGb: 1.2,
    ramGb: 3,
    status: "available",
  },
  {
    name: "clef-flash",
    kind: "decision",
    runtime: "ollama",
    downloadGb: 11,
    loadedGb: 12,
    ramGb: 16,
    vramGb: 12,
    minOllama: "0.35.1",
    status: "available",
  },
  {
    name: "clef",
    kind: "decision",
    runtime: "ollama",
    downloadGb: 17,
    loadedGb: 19,
    ramGb: 32,
    vramGb: 20,
    minOllama: "0.35.1",
    status: "available",
  },
  {
    name: "onnx-community/whisper-base",
    kind: "stt",
    runtime: "browser",
    downloadGb: 0.15,
    loadedGb: 0.4,
    ramGb: 2,
    status: "available",
  },
  {
    name: "onnx-community/whisper-small",
    kind: "stt",
    runtime: "browser",
    downloadGb: 0.5,
    loadedGb: 1,
    ramGb: 4,
    status: "available",
  },
  {
    name: "gemma4:e2b",
    kind: "generate",
    runtime: "ollama",
    downloadGb: 6,
    loadedGb: 7,
    ramGb: 8,
    vramGb: 8,
    status: "available",
  },
  {
    name: "gemma4:e4b",
    kind: "generate",
    runtime: "ollama",
    downloadGb: 9,
    loadedGb: 10,
    ramGb: 16,
    vramGb: 12,
    status: "available",
  },
  {
    name: "qwen3-vl:2b",
    kind: "generate",
    runtime: "ollama",
    downloadGb: 2,
    loadedGb: 3,
    ramGb: 6,
    vramGb: 4,
    status: "available",
  },
  {
    name: "lfm3-vl",
    kind: "generate",
    runtime: "ollama",
    downloadGb: 1.5,
    loadedGb: 2.5,
    ramGb: 4,
    vramGb: 4,
    status: "available",
  },
  {
    name: "qwen3-vl",
    kind: "vision",
    runtime: "ollama",
    downloadGb: 6,
    loadedGb: 7,
    ramGb: 12,
    vramGb: 8,
    status: "planned",
  },
];

export function fits(ramGb: number, model: LocalModel): "fits" | "tight" | "too big" {
  if (ramGb >= model.ramGb) return "fits";
  if (ramGb >= model.ramGb * 0.75) return "tight";
  return "too big";
}

export function versionAtLeast(v: string, min: string): boolean {
  const a = v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const b = min.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
