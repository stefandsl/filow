// Catalog of local models the Settings page can install, with hardware hints.
export type LocalModel = {
  name: string; // Ollama tag, or transformers.js model id for runtime "browser"
  kind: "decision" | "vision" | "stt";
  runtime: "ollama" | "browser";
  label: string;
  description: string;
  downloadGb: number;
  ramGb: number;
  minOllama?: string;
  status: "available" | "planned";
};

export const LOCAL_MODELS: LocalModel[] = [
  {
    name: "clef-flash",
    kind: "decision",
    runtime: "ollama",
    label: "Clef Flash (9B)",
    description: "Cloudflare's fast decision model. Replaces the cloud classifier for the per-point yes/no decisions. ~40 ms per call on a GPU.",
    downloadGb: 6,
    ramGb: 16,
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
    ramGb: 32,
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
    ramGb: 4,
    status: "available",
  },
  {
    name: "qwen3-vl",
    kind: "vision",
    runtime: "ollama",
    label: "Qwen3-VL (vision)",
    description: "Local slide summaries for Screen Sense. Wired when Screen Sense ships.",
    downloadGb: 6,
    ramGb: 12,
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
