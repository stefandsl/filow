// Embedding gate (Step 3 of docs/gauntlet/REPORT-lap1.md). Pattern adapted from Jarvis' embedding
// intent classifier (vectors prepared ahead, cached under a content hash, cosine at query time), with
// the two changes a prompter needs: several candidates per window instead of a single winner, and an
// explicit "no match" that answers without calling the decision model at all.
// Pure: the embedder is injected (transformers.js in a Web Worker in the app, Node in the harness).
import type { Bullet } from "./types";
import type { DecideRequest, DecideResponse, Decision } from "./api";

export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

export const GATE_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
/** Bump when the text preparation below changes: cached vectors are keyed on it. */
export const GATE_PREP_VERSION = 1;

export type GateThresholds = {
  /** below this similarity a point is not even a candidate (no model call for it) */
  low: number;
  /** at most this many candidates go to the decision model per call */
  maxCandidates: number;
  /** characters of the most recent transcript that get embedded (the whole window is too diluted) */
  tailChars: number;
};
export const DEFAULT_GATE: GateThresholds = { low: 0.3, maxCandidates: 4, tailChars: 320 };

export type PointVectors = { key: string; ids: string[]; vectors: Float32Array[] };

/** Stable key for the cache: model, preparation version, language and the exact point texts. */
export function gateCacheKey(bullets: Bullet[], language: string, model = GATE_MODEL): string {
  const text = `${model}|v${GATE_PREP_VERSION}|${language}|${bullets.map((b) => `${b.id}=${b.text}`).join("\n")}`;
  // FNV-1a over UTF-16 code units: fast, dependency-free, collision risk irrelevant for a cache key
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${model.split("/").pop()}-v${GATE_PREP_VERSION}-${language}-${h.toString(16)}-${bullets.length}`;
}

/** Text that goes into the embedder for a point: the point itself, nothing else. */
export function preparePointText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The part of the transcript worth embedding: its most recent tail. */
export function prepareWindowText(transcript: string, tailChars = DEFAULT_GATE.tailChars): string {
  const t = transcript.replace(/\s+/g, " ").trim();
  return t.length > tailChars ? t.slice(-tailChars) : t;
}

export async function embedPoints(embed: Embedder, bullets: Bullet[], language: string): Promise<PointVectors> {
  const vectors = bullets.length ? await embed(bullets.map((b) => preparePointText(b.text))) : [];
  return { key: gateCacheKey(bullets, language), ids: bullets.map((b) => b.id), vectors: vectors.map(normalize) };
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export type GateScore = { id: string; similarity: number };

/** Similarity of the transcript tail to every point, best first. */
export function scorePoints(windowVector: Float32Array, points: PointVectors, bullets: Bullet[]): GateScore[] {
  const w = normalize(windowVector);
  const byId = new Map(points.ids.map((id, i) => [id, points.vectors[i]]));
  return bullets
    .map((b) => ({ id: b.id, similarity: byId.has(b.id) ? cosine(w, byId.get(b.id)!) : 0 }))
    .sort((a, b) => b.similarity - a.similarity);
}

export type GateOutcome = {
  /** bullets worth asking the model about, in similarity order */
  candidates: Bullet[];
  /** every point with its similarity, best first */
  scores: GateScore[];
  /** true when nothing passed the gate: answer locally, no model call */
  skipped: boolean;
};

export function gate(scores: GateScore[], bullets: Bullet[], th: GateThresholds = DEFAULT_GATE): GateOutcome {
  const byId = new Map(bullets.map((b) => [b.id, b]));
  const candidates = scores
    .filter((s) => s.similarity >= th.low)
    .slice(0, th.maxCandidates)
    .map((s) => byId.get(s.id)!)
    .filter(Boolean);
  return { candidates, scores, skipped: candidates.length === 0 };
}

/**
 * Wraps a decision provider with the gate: embeds the transcript tail, asks the model only about the
 * candidates, and answers "not started" locally for the rest (confidence = similarity, so the engine
 * still sees a trend). With no candidate the model is not called at all.
 */
export function gatedDecide(
  decide: (r: DecideRequest, signal?: AbortSignal) => Promise<DecideResponse>,
  embed: Embedder,
  points: () => PointVectors | null,
  th: GateThresholds = DEFAULT_GATE,
  onGate?: (o: GateOutcome & { skipped: boolean }) => void,
): (r: DecideRequest, signal?: AbortSignal) => Promise<DecideResponse> {
  return async (r, signal) => {
    const pv = points();
    if (!pv || !r.bullets.length) return decide(r, signal);
    const t0 = Date.now();
    const [wv] = await embed([prepareWindowText(r.transcript, th.tailChars)]);
    const scores = scorePoints(wv, pv, r.bullets);
    const out = gate(scores, r.bullets, th);
    onGate?.(out);
    const sim = new Map(scores.map((s) => [s.id, s.similarity]));
    const local = (b: Bullet): Decision => ({ id: b.id, started: false, confidence: Math.max(0, Math.min(0.49, (sim.get(b.id) ?? 0) * 0.6)) });
    if (out.skipped) {
      return { decisions: r.bullets.map(local), latencyMs: Date.now() - t0, cost: 0, model: "gate (no candidate)" };
    }
    const asked = new Set(out.candidates.map((b) => b.id));
    const res = await decide({ ...r, bullets: out.candidates }, signal);
    const answered = new Map(res.decisions.map((d) => [d.id, d]));
    return {
      ...res,
      decisions: r.bullets.map((b) => (asked.has(b.id) && answered.has(b.id) ? answered.get(b.id)! : local(b))),
      model: `${res.model} · gate ${out.candidates.length}/${r.bullets.length}`,
    };
  };
}
