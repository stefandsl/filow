// Catalog of local models the Settings page can install, with hardware hints.
export type LocalModel = {
  name: string; // Ollama tag, or transformers.js model id for runtime "browser"
  kind: "decision" | "vision" | "stt" | "generate";
  runtime: "ollama" | "browser" | "sherpa";
  label: string;
  description: string;
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
    label: "Nemotron 3.5 streaming speech-to-text (on this PC)",
    description: "NVIDIA's streaming recogniser run by sherpa-onnx inside the desktop app: words appear as you say them, Italian and English. Measured on a Core Ultra 7 laptop: 105 ms of CPU per 560 ms of speech on 4 threads.",
    downloadGb: 0.45,
    loadedGb: 1.2,
    ramGb: 3,
    status: "available",
  },
  {
    name: "clef-flash",
    kind: "decision",
    runtime: "ollama",
    label: "Clef Flash (9B)",
    description: "Cloudflare's fast decision model. Replaces the cloud classifier for the per-point yes/no decisions. ~40 ms per call on a GPU.",
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
    label: "Clef (27B, multimodal)",
    description: "More accurate on long point lists; can also judge screen frames. Needs a big machine.",
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
    label: "Whisper base (on-device speech-to-text)",
    description: "Runs inside the app (WebGPU or WebAssembly). Fastest; fine for clear speech. Cached by the browser after the first download.",
    downloadGb: 0.15,
    loadedGb: 0.4,
    ramGb: 2,
    status: "available",
  },
  {
    name: "onnx-community/whisper-small",
    kind: "stt",
    runtime: "browser",
    label: "Whisper small (on-device speech-to-text)",
    description: "Better accuracy; needs a GPU for comfortable latency.",
    downloadGb: 0.5,
    loadedGb: 1,
    ramGb: 4,
    status: "available",
  },
  {
    name: "gemma4:e2b",
    kind: "generate",
    runtime: "ollama",
    label: "Gemma 4 E2B (script from slides, text + images)",
    description: "Default local model for 'Generate script from slides': reads slide text and slide images, Italian included. Fits 8 GB RAM.",
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
    label: "Gemma 4 E4B (script from slides, better)",
    description: "Same job with better wording and chart reading. Pick it on a 16 GB machine; set GENERATE_LOCAL_MODEL=gemma4:e4b.",
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
    label: "Qwen3-VL 2B (script from slides, light)",
    description: "Light fallback for small machines; weaker on long slides. Set GENERATE_LOCAL_MODEL=qwen3-vl:2b.",
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
    label: "Liquid LFM3-VL 2B (ultra light, English)",
    description: "Optional ultra-light vision model (2B, text + images). Italian is not among its listed languages; use it for English decks only. Set GENERATE_LOCAL_MODEL=lfm3-vl.",
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
    label: "Qwen3-VL (vision)",
    description: "Local slide summaries for Screen Sense. Screen Sense uses the OpenRouter vision model until this is wired (ARCHITECTURE.md §6.7).",
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
