// Catalog of local models the Settings page can install, with hardware hints.
export type LocalModel = {
  name: string; // Ollama tag
  kind: "decision" | "vision" | "stt";
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
    label: "Clef (27B, multimodal)",
    description: "More accurate on long point lists; can also judge screen frames. Needs a big machine.",
    downloadGb: 17,
    ramGb: 32,
    minOllama: "0.35.1",
    status: "available",
  },
  {
    name: "qwen3-vl",
    kind: "vision",
    label: "Qwen3-VL (vision)",
    description: "Local slide summaries for Screen Sense. Wired when Screen Sense ships.",
    downloadGb: 6,
    ramGb: 12,
    status: "planned",
  },
  {
    name: "whisper-small",
    kind: "stt",
    label: "Whisper small (local speech-to-text)",
    description: "On-device transcription (whisper.cpp). Planned: the backend and model download land in the next pass.",
    downloadGb: 0.5,
    ramGb: 4,
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
