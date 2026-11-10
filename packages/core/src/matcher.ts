// Decisions without a language model, for machines with no graphics card (the Lite setup).
// Measured on the P3 profile run (docs/gauntlet/BASELINE.md): a 1.7B model answering the decision
// prompt takes 6 to 14 s per call on the CPU of a Core i9 desktop, far over the engine's 2.5 s timeout, so on
// such machines the gate's own scores decide: the embedding similarity of the transcript tail to each
// point and the lexical match (names, numbers, terms), turned into a confidence. A few milliseconds per
// call. The engine's guard (numbers, negation, contradiction) and confirm rule apply as for any model.
import type { DecideRequest, DecideResponse, Decision } from "./api";
import { lexicalScores, prepareWindowText, scorePoints, type Embedder, type GateScore, type PointVectors } from "./gate";

export const MATCHER_MODEL = "on-device matcher";

export type MatcherThresholds = {
  /** characters of the most recent transcript that are embedded */
  tailChars: number;
  /** embedding similarity where a point starts to count as started (confidence 0.70) */
  simStart: number;
  /** embedding similarity read as certain (confidence 0.95) */
  simSure: number;
  /** lexical score where a point starts to count as started */
  lexStart: number;
  /** lexical score read as certain */
  lexSure: number;
  /**
   * another open point this close to the best one (in the same score) makes the answer ambiguous:
   * both stay under 0.70, as the decision prompt asks ("credit only the one that best matches").
   */
  margin: number;
  /**
   * the last this-many sentences of the tail (5 words or more) are also scored on their own (0: the
   * tail only). P3 gauntlet: 1 brought recall from 19 to 23 of 26 with no false completion; 3-word
   * sentences ("We do backups.") were too short to judge and completed a point that was only named.
   */
  perSentence: number;
};

export const DEFAULT_MATCHER: MatcherThresholds = { tailChars: 320, simStart: 0.6, simSure: 0.8, lexStart: 0.75, lexSure: 1, margin: 0.05, perSentence: 1 };

/**
 * Sentences that only announce a point ("later I will also cover the pricing", "tra poco vi parlerò
 * del portale") share its words without making it. A model reads the difference; the matcher cannot,
 * so such sentences are left out of what it scores. When the speaker then really talks about it, the
 * following sentences carry it. English and Italian, the languages of the gauntlet corpora.
 */
const ANNOUNCEMENT = new RegExp(
  [
    String.raw`\b(later|afterwards|in a (moment|minute|bit)|further on)\b`,
    String.raw`\b(i|we)('ll| will| am going to| are going to| shall)\s+(also\s+)?(talk|cover|come back|get to|tell you|show you|look at|go through|explain)\b`,
    String.raw`\b(tra poco|fra poco|più avanti|piu avanti|in seguito|successivamente|alla fine)\b`,
    String.raw`\b(vi parlerò|vi parlero|parleremo|vedremo|vi mostrerò|vi mostrero|tornerò|tornero|torneremo|affronteremo)\b`,
  ].join("|"),
  "i",
);

export function isAnnouncement(sentence: string): boolean {
  return ANNOUNCEMENT.test(sentence);
}

/** The transcript tail without its announcement-only sentences. */
export function withoutAnnouncements(tail: string): string {
  const sentences = tail.split(/(?<=[.!?;])\s+/);
  return sentences.filter((s) => !isAnnouncement(s)).join(" ").trim();
}

/** One stage's score as a confidence: under `start` it can only hint (max 0.49), from `start` to `sure` it rises 0.70 to 0.95. */
export function stageConfidence(score: number, start: number, sure: number): number {
  if (!Number.isFinite(start) || score < start) return Math.max(0, Math.min(0.49, score * 0.6));
  if (sure <= start) return 0.95;
  return Math.min(0.95, 0.7 + (0.25 * (score - start)) / (sure - start));
}

/** Confidence per point from its gate scores; the runner-up rule keeps near ties ambiguous. */
export function matcherDecisions(scores: GateScore[], th: MatcherThresholds = DEFAULT_MATCHER): Decision[] {
  const sim = (s: GateScore) => stageConfidence(s.similarity, th.simStart, th.simSure);
  const lex = (s: GateScore) => stageConfidence(s.lexical ?? 0, th.lexStart, th.lexSure);
  const raw = scores.map((s) => ({ s, c: Math.max(sim(s), lex(s)) }));
  return raw.map(({ s, c }) => {
    let confidence = c;
    if (c >= 0.7) {
      // a near tie on the stage that made this point pass: neither point is credited yet
      const bySim = sim(s) >= lex(s);
      const own = bySim ? s.similarity : (s.lexical ?? 0);
      const rival = scores.some((o) => o.id !== s.id && (bySim ? o.similarity : (o.lexical ?? 0)) >= own - th.margin);
      if (rival) confidence = 0.69;
    }
    confidence = Math.round(confidence * 1000) / 1000;
    return { id: s.id, started: confidence >= 0.7, confidence, gate: Math.round(s.similarity * 1000) / 1000, ...(s.lexical !== undefined ? { lexical: s.lexical } : {}) };
  });
}

/**
 * A decision provider made of the matcher alone. Until the point vectors are ready it answers "not
 * started" for every point (nothing is guessed), so a take can start before the embedder has loaded.
 */
export function matcherDecide(
  embed: Embedder,
  points: () => PointVectors | null,
  th: MatcherThresholds = DEFAULT_MATCHER,
): (r: DecideRequest, signal?: AbortSignal) => Promise<DecideResponse> {
  return async (r) => {
    const t0 = Date.now();
    const pv = points();
    if (!pv || !r.bullets.length) {
      return { decisions: r.bullets.map((b) => ({ id: b.id, started: false, confidence: 0 })), latencyMs: Date.now() - t0, cost: 0, model: MATCHER_MODEL };
    }
    const tail = withoutAnnouncements(prepareWindowText(r.transcript, th.tailChars));
    if (!tail) return { decisions: r.bullets.map((b) => ({ id: b.id, started: false, confidence: 0 })), latencyMs: Date.now() - t0, cost: 0, model: MATCHER_MODEL };
    // the tail as a whole, and its last few sentences on their own: a point said in one sentence is
    // diluted when the tail also holds the sentences around it
    const sentences = th.perSentence > 0 ? tail.split(/(?<=[.!?;])\s+/).filter((s) => s.split(/\s+/).length >= 5).slice(-th.perSentence) : [];
    const vectors = await embed([tail, ...sentences]);
    const best = new Map<string, number>();
    for (const v of vectors) for (const s of scorePoints(v, pv, r.bullets)) best.set(s.id, Math.max(best.get(s.id) ?? -1, s.similarity));
    const lex = lexicalScores(tail, r.bullets);
    const scores = r.bullets.map((b) => ({ id: b.id, similarity: best.get(b.id) ?? 0, lexical: lex.get(b.id) }));
    const byId = new Map(matcherDecisions(scores, th).map((d) => [d.id, d]));
    return { decisions: r.bullets.map((b) => byId.get(b.id) ?? { id: b.id, started: false, confidence: 0 }), latencyMs: Date.now() - t0, cost: 0, model: MATCHER_MODEL };
  };
}
