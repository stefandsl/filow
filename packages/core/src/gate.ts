// Embedding gate (Step 3 of docs/gauntlet/REPORT-lap1.md). Pattern adapted from Jarvis' embedding
// intent classifier (vectors prepared ahead, cached under a content hash, cosine at query time), with
// the two changes a prompter needs: several candidates per window instead of a single winner, and an
// explicit "no match" that answers without calling the decision model at all.
// Pure: the embedder is injected (transformers.js in a Web Worker in the app, Node in the harness).
import type { Bullet } from "./types";
import type { DecideRequest, DecideResponse, Decision, DecisionProviderId } from "./api";
import { contentTokens, FUZZY_MIN, quantitiesFromTokens, sameQuantity, similarity, tokenize, type Quantity } from "./text";

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
  /**
   * lexical stage: a point whose words (names, numbers, terms) the tail shares at or above this score
   * is a candidate even when the embedding missed it. Infinity turns the stage off.
   */
  lexicalLow: number;
  /**
   * true (default): the model is asked only about the candidates. false: the gate only decides
   * whether to call the model; once any point passes, every open point is asked, as without the gate
   * (measured on local Clef, P1: a narrower question set changes its answers and costs recall).
   */
  narrow?: boolean;
};
export const DEFAULT_GATE: GateThresholds = { low: 0.3, maxCandidates: 4, tailChars: 320, lexicalLow: 0.5 };

/**
 * The gate for a decision provider. Local Clef answers all its questions in one pass, and asking it
 * about fewer points changes its answers: on the P1 gauntlet (docs/gauntlet/BASELINE.md) the
 * narrowed gate cost it 2 of 26 true points, the skip-only gate none. Other providers keep the
 * narrowed gate measured in Step 3.
 */
export function gateThresholdsFor(provider: DecisionProviderId | undefined): GateThresholds {
  return provider === "clef-local" ? { ...DEFAULT_GATE, narrow: false } : DEFAULT_GATE;
}

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

export type GateScore = { id: string; similarity: number; lexical?: number };

// ---- lexical stage --------------------------------------------------------------------------------

type Term = { word?: string; qty?: Quantity };

function pointTerms(text: string): Term[] {
  const words = [...new Set(contentTokens(text))].map((word) => ({ word }));
  const qtys = quantitiesFromTokens(tokenize(text)).filter((q) => q.kind !== "year").map((qty) => ({ qty }));
  return [...words, ...qtys];
}

function termMatch(t: Term, words: string[], qtys: Quantity[]): number {
  if (t.qty) return qtys.some((q) => sameQuantity(t.qty!, q)) ? 1 : 0;
  let best = 0;
  for (const w of words) {
    const s = similarity(t.word!, w);
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best >= FUZZY_MIN ? best : 0;
}

/**
 * Lexical score of the transcript tail for each point, 0..1: the share of the point's terms (content
 * words and quantities, spelled-out numbers read as numbers) heard in the tail, each term weighted by
 * its BM25 inverse document frequency over the points, so a word every point has counts little and a
 * name or number only one point has counts a lot. Words match fuzzily ("tagliato" ~ "tagliati").
 * Points are a few words long, so BM25's term-frequency saturation and length normalisation cancel
 * out in the per-point normalisation and are left out.
 */
export function lexicalScores(tail: string, bullets: Bullet[]): Map<string, number> {
  const toks = tokenize(tail);
  const words = [...new Set(toks.map((t) => t.norm).filter((w) => /^\p{L}{2,}$/u.test(w)))];
  const qtys = quantitiesFromTokens(toks);
  const terms = bullets.map((b) => pointTerms(b.text));
  const n = bullets.length;
  const out = new Map<string, number>();
  bullets.forEach((b, i) => {
    let num = 0;
    let den = 0;
    for (const t of terms[i]) {
      // document frequency: points that have this term too (fuzzily, or the same quantity)
      const df = terms.filter((other) => other.some((o) => (t.qty ? o.qty && sameQuantity(t.qty, o.qty) : o.word && similarity(t.word!, o.word) >= FUZZY_MIN))).length;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      den += idf;
      num += idf * termMatch(t, words, qtys);
    }
    out.set(b.id, den > 0 ? Math.round((num / den) * 1000) / 1000 : 0);
  });
  return out;
}

/** The fused score a point is ranked by: the better of the two stages. */
export function fusedScore(s: GateScore): number {
  return Math.max(s.similarity, s.lexical ?? 0);
}

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
  /** candidates that passed only through the lexical stage */
  lexicalOnly: number;
};

export function gate(scores: GateScore[], bullets: Bullet[], th: GateThresholds = DEFAULT_GATE): GateOutcome {
  const byId = new Map(bullets.map((b) => [b.id, b]));
  const lexLow = th.lexicalLow ?? Infinity;
  const passed = scores
    .filter((s) => s.similarity >= th.low || (s.lexical ?? 0) >= lexLow)
    .sort((a, b) => fusedScore(b) - fusedScore(a))
    .slice(0, th.maxCandidates);
  const candidates = passed.map((s) => byId.get(s.id)!).filter(Boolean);
  const lexicalOnly = passed.filter((s) => s.similarity < th.low).length;
  return { candidates, scores, skipped: candidates.length === 0, lexicalOnly };
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
    const tail = prepareWindowText(r.transcript, th.tailChars);
    const [wv] = await embed([tail]);
    const lex = Number.isFinite(th.lexicalLow ?? Infinity) ? lexicalScores(tail, r.bullets) : new Map<string, number>();
    const scores = scorePoints(wv, pv, r.bullets).map((s) => ({ ...s, lexical: lex.get(s.id) }));
    const out = gate(scores, r.bullets, th);
    onGate?.(out);
    const byId = new Map(scores.map((s) => [s.id, s]));
    const tag = (d: Decision): Decision => {
      const s = byId.get(d.id);
      return s ? { ...d, gate: Math.round(s.similarity * 1000) / 1000, ...(s.lexical !== undefined ? { lexical: s.lexical } : {}) } : d;
    };
    const local = (b: Bullet): Decision => tag({ id: b.id, started: false, confidence: Math.max(0, Math.min(0.49, fusedScore(byId.get(b.id) ?? { id: b.id, similarity: 0 }) * 0.6)) });
    if (out.skipped) {
      return { decisions: r.bullets.map(local), latencyMs: Date.now() - t0, cost: 0, model: "gate (no candidate)" };
    }
    const ask = th.narrow === false ? r.bullets : out.candidates;
    const asked = new Set(ask.map((b) => b.id));
    const res = await decide({ ...r, bullets: ask }, signal);
    const answered = new Map(res.decisions.map((d) => [d.id, d]));
    return {
      ...res,
      decisions: r.bullets.map((b) => (asked.has(b.id) && answered.has(b.id) ? tag(answered.get(b.id)!) : local(b))),
      model: `${res.model} · gate ${out.candidates.length}/${r.bullets.length}`,
    };
  };
}
