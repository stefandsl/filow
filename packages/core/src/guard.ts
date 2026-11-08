// Claim guard (P1 step 2, docs/PRODUCTION-PLAN.md): before a point flips, its numbers, units,
// direction words and negation are compared with what was actually said. A contradiction ("costs rose
// 30%" for a point that says they fell, "we did not cut" for "we cut", 21% for 12%, days for hours)
// never flips a point, whatever confidence the decision model gave. Conservative by design: it only
// blocks on an explicit conflict; vague or paraphrased speech is left to the model.
// Pure and language-light (Italian and English word lists), no model.
import { contentTokens, FUZZY_MIN, NEGATIONS, quantitiesFromTokens, sameQuantity, sentences, similarity, tokenize, type Quantity, type Sentence, type Token } from "./text";

export type GuardConflict = {
  kind: "negation" | "number" | "unit" | "direction";
  /** short human-readable reason, e.g. "point says 12 percent, speech says 21" */
  detail: string;
};

export type ClaimCheck = {
  /** false when every sentence about the point contradicts it */
  ok: boolean;
  /** the sentence that supports the point (ok) or the one that contradicts it (blocked); null when nothing in the transcript is about the point's words */
  evidence: Sentence | null;
  /** share of the point's content words found (fuzzily) in the evidence sentence, 0..1 */
  lexical: number;
  conflict?: GuardConflict;
};

const UP = /^(aument\w*|cresc\w*|crebb\w*|salit[oaie]|sal(e|go|gono|ire|ira|iranno)|rialz\w*|incrementat\w*|rose|rise[sn]?|rising|increas\w*|grew|grow|grows|growing|grown|climb\w*|up|higher|raise[ds]?|raising|doubled|tripled|raddoppiat\w*|triplicat\w*)$/;
const DOWN = /^(cal(o|a|i|e|at[oaie]|ano|are|ando|era|eranno)|diminu\w*|ridott[oaie]|riduzion\w*|ridu(co|ce|cono|rre|rremo|rra)|tagli\w*|sces[oaie]|scend\w*|fell|fall|falls|falling|fallen|drop\w*|decreas\w*|declin\w*|cut|cuts|cutting|down|lower\w*|reduc\w*|shr[iau]nk\w*|halved|dimezzat\w*)$/;

function direction(t: string): "up" | "down" | null {
  return UP.test(t) ? "up" : DOWN.test(t) ? "down" : null;
}

/** Negation words that do not deny what follows: "non solo", "not only", "no doubt". */
function negates(toks: Token[], i: number): boolean {
  const t = toks[i].norm;
  if (!NEGATIONS.has(t)) return false;
  const next = toks[i + 1]?.norm ?? "";
  // "senza niente", "senza nessun aiuto", "without any": the preposition already says "without"
  const prev = toks[i - 1]?.norm ?? "";
  if (prev === "senza" || prev === "without") return false;
  if ((t === "non" && (next === "solo" || next === "soltanto")) || (t === "not" && (next === "only" || next === "just"))) return false;
  if ((t === "no" || t === "nessun") && (next === "doubt" || next === "dubbio")) return false;
  return true;
}

/** True when a pause (comma, colon, full stop...) separates token a from token b in the text. */
function pauseBetween(text: string, a: Token, b: Token): boolean {
  return /[,.;:!?()]/.test(text.slice(a.end, b.start));
}

const SCOPE = 4;

/** Does the text deny one of the point's words (a negation up to 4 tokens before it, in the same clause)? */
function deniesPointWords(text: string, toks: Token[], pointWords: string[]): boolean {
  for (let i = 0; i < toks.length; i++) {
    if (!negates(toks, i)) continue;
    for (let k = i + 1; k <= i + SCOPE && k < toks.length; k++) {
      if (pauseBetween(text, toks[k - 1], toks[k])) break;
      if (pointWords.some((w) => similarity(w, toks[k].norm) >= FUZZY_MIN)) return true;
    }
  }
  return false;
}

function hasNegation(toks: Token[]): boolean {
  return toks.some((_, i) => negates(toks, i));
}

const label = (q: Quantity) => (q.kind === "duration" ? `${q.raw} (${Math.round(q.value / 3600)} h)` : `${q.raw}${q.kind === "percent" ? "%" : q.kind.startsWith("currency:") ? ` ${q.kind.slice(9)}` : ""}`);
const klass = (q: Quantity) => (q.kind.startsWith("currency:") ? "currency" : q.kind);

/** The first explicit conflict between the point and one sentence, if any. */
export function conflictBetween(point: string, sentence: string): GuardConflict | undefined {
  const pt = tokenize(point);
  const st = tokenize(sentence);
  const words = contentTokens(point);

  // numbers and units (years are never compared: "rispetto al 2024" is not a wrong year)
  const pq = quantitiesFromTokens(pt).filter((q) => q.kind !== "year");
  const sq = quantitiesFromTokens(st).filter((q) => q.kind !== "year");
  for (const q of pq) {
    const same = sq.filter((s) => klass(s) === klass(q));
    if (same.length && !same.some((s) => sameQuantity(q, s))) {
      return { kind: "number", detail: `point says ${label(q)}, speech says ${same.map(label).join(", ")}` };
    }
    if (!same.length) {
      const other = sq.find((s) => s.kind !== "count" && s.raw === q.raw);
      if (other) return { kind: "unit", detail: `point says ${label(q)}, speech says ${label(other)}` };
    }
  }

  // negation: an affirmative point denied in the speech, or a negated point said with no negation at all
  const pointNegated = hasNegation(pt);
  if (!pointNegated && deniesPointWords(sentence, st, words)) return { kind: "negation", detail: "the speech denies the point" };
  if (pointNegated && !hasNegation(st)) return { kind: "negation", detail: "the point is a negation, the speech is not" };

  // direction: the point goes one way, the speech only the other way
  const pd = new Set(pt.map((t) => direction(t.norm)).filter(Boolean));
  if (pd.size === 1) {
    const want = [...pd][0];
    const sd = new Set(st.map((t) => direction(t.norm)).filter(Boolean));
    if (!sd.has(want) && sd.size) return { kind: "direction", detail: `point says ${want}, speech says ${[...sd][0]}` };
  }
  return undefined;
}

function coverage(words: string[], toks: Token[]): number {
  if (!words.length) return 0;
  let s = 0;
  for (const w of words) {
    let best = 0;
    for (const t of toks) best = Math.max(best, similarity(w, t.norm));
    if (best >= FUZZY_MIN) s += best;
  }
  return s / words.length;
}

const MIN_RELEVANT = 0.34;

/**
 * Checks a point against the transcript the decision was made on. The sentences about the point are
 * those sharing at least a third of its content words (or one of its quantities); the point passes
 * when at least one of them has no conflict, and that sentence (the best covered, the latest on a tie)
 * is the evidence. It is blocked when every such sentence contradicts it.
 */
export function checkClaim(point: string, transcript: string): ClaimCheck {
  const words = contentTokens(point);
  const pq = quantitiesFromTokens(tokenize(point)).filter((q) => q.kind !== "year");
  const scored = sentences(transcript).map((s) => {
    const toks = tokenize(s.text);
    const lexical = coverage(words, toks);
    const sq = quantitiesFromTokens(toks);
    const numberMatch = pq.some((q) => sq.some((x) => sameQuantity(q, x)));
    return { s, lexical, relevance: Math.min(1, lexical + (numberMatch ? 0.5 : 0)) };
  });
  const best = Math.max(0, ...scored.map((x) => x.relevance));
  if (best < MIN_RELEVANT) {
    const top = scored.reduce<(typeof scored)[number] | null>((a, x) => (!a || x.lexical >= a.lexical ? x : a), null);
    return { ok: true, evidence: top && top.lexical > 0 ? top.s : null, lexical: top?.lexical ?? 0 };
  }
  const candidates = scored.filter((x) => x.relevance >= Math.max(MIN_RELEVANT, best * 0.5));
  let pass: (typeof scored)[number] | null = null;
  let firstConflict: { x: (typeof scored)[number]; c: GuardConflict } | null = null;
  for (const x of candidates) {
    const c = conflictBetween(point, x.s.text);
    if (c) {
      if (!firstConflict || x.relevance >= firstConflict.x.relevance) firstConflict = { x, c };
    } else if (!pass || x.relevance >= pass.relevance) pass = x;
  }
  if (pass) return { ok: true, evidence: pass.s, lexical: Math.round(pass.lexical * 100) / 100 };
  const f = firstConflict!;
  return { ok: false, evidence: f.x.s, lexical: Math.round(f.x.lexical * 100) / 100, conflict: f.c };
}
