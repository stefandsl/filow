// Claim guard (P1 step 2, docs/PRODUCTION-PLAN.md): before a point flips, its numbers, units,
// direction words and negation are compared with what was actually said. A contradiction ("costs rose
// 30%" for a point that says they fell, "we did not cut" for "we cut", 21% for 12%, days for hours)
// never flips a point, whatever confidence the decision model gave. Conservative by design: it only
// blocks on an explicit conflict in a sentence about the point; vague or paraphrased speech is left to
// the model. Pure and language-light (Italian and English word lists), no model.
import { contentTokens, FUZZY_MIN, NEGATIONS, quantitiesFromTokens, sameQuantity, sentences, similarity, tokenize, type Quantity, type Sentence, type Token } from "./text";

export type GuardConflict = {
  kind: "negation" | "number" | "unit" | "direction";
  /** short human-readable reason, e.g. "point says 12%, speech says 21%" */
  detail: string;
};

export type ClaimCheck = {
  /** false when the latest sentence that states the point's claim contradicts it */
  ok: boolean;
  /** the sentence that supports the point (ok) or the one that contradicts it (blocked); null when nothing in the transcript is about the point's words */
  evidence: Sentence | null;
  /** share of the point's content words found (fuzzily) in the evidence sentence, 0..1 */
  lexical: number;
  conflict?: GuardConflict;
};

// ---- word lists -----------------------------------------------------------------------------------

const UP = /^(aument\w*|cresc\w*|crebb\w*|salit[oaie]|salgono|salire|salira|saliranno|rialz\w*|incrementat\w*|balz\w*|impenn\w*|schizzat\w*|raddoppi\w*|triplica\w*|rose|rise[sn]?|rising|increas\w*|grew|grow|grows|growing|grown|climb\w*|jump\w*|soar\w*|surg\w*|spik\w*|rocket\w*|higher|raise[ds]?|raising|doubled|tripled)$/;
const DOWN = /^(cal(o|a|i|e|at[oaie]|ano|are|ando|era|eranno)|diminu\w*|ridott[oaie]|riduzion\w*|ridu(co|ce|cono|rre|rremo|rra)|tagli\w*|sces[oaie]|scend\w*|croll\w*|precipit\w*|dimezz\w*|fell|fall|falls|falling|fallen|drop\w*|decreas\w*|declin\w*|cut|cuts|cutting|lower\w*|reduc\w*|shr[iau]nk\w*|halved|plung\w*|plummet\w*|slump\w*|sank|sink\w*|tumbl\w*)$/;
/** "up"/"down" are a direction only after a verb of motion or before a number ("went up", "down 5%"), never in "set up". */
const MOTION = new Set(["went", "go", "goes", "going", "gone", "come", "came", "coming", "is", "are", "was", "were", "been", "be", "moved", "move"]);

function directionAt(toks: Token[], i: number): "up" | "down" | null {
  const t = toks[i].norm;
  if (t === "up" || t === "down") {
    const prev = toks[i - 1]?.norm ?? "";
    const next = toks[i + 1]?.norm ?? "";
    if (!MOTION.has(prev) && !/^\d/.test(next)) return null;
    return t;
  }
  return UP.test(t) ? "up" : DOWN.test(t) ? "down" : null;
}

/** Verbal negators deny the predicate that follows; nominal ones only the noun right after them. */
const NOMINAL_NEGATIONS = new Set(["no", "nessun", "nessuno", "nessuna", "niente", "nulla", "none", "nothing", "nobody"]);
/** Verbs that turn a negation into an affirmation of what follows: "don't forget we cut", "nobody expected us to cut". */
const NEUTRAL_AFTER_NEGATION = /^(forget|forgot|forgotten|dimentic\w*|scord\w*|expect\w*|aspett\w*|doubt\w*|dubit\w*|surprise\w*|stupi\w*|hide|nascond\w*|deny|neg\w*)$/;
/** Words that end a negation's reach: a new clause or subject. */
const SCOPE_END = new Set(["che", "chi", "ma", "perche", "mentre", "invece", "that", "which", "who", "but", "because", "while", "whereas", "although", "e", "and"]);
const SCOPE = 5;

/** Is the negation word at i a real denial? Not "non solo", "not only", "no doubt", "come mai", "più che mai", "senza niente". */
function negates(toks: Token[], i: number): boolean {
  const t = toks[i].norm;
  if (!NEGATIONS.has(t)) return false;
  const next = toks[i + 1]?.norm ?? "";
  const prev = toks[i - 1]?.norm ?? "";
  if ((t === "non" && (next === "solo" || next === "soltanto")) || (t === "not" && (next === "only" || next === "just"))) return false;
  if ((t === "no" || t === "nessun") && (next === "doubt" || next === "dubbio")) return false;
  if (t === "mai" && (prev === "come" || prev === "che")) return false; // "come mai...?", "più che mai"
  if (prev === "senza" || prev === "without") return false; // "senza niente": the preposition says it
  for (let k = i + 1; k <= i + 2 && k < toks.length; k++) if (NEUTRAL_AFTER_NEGATION.test(toks[k].norm)) return false;
  return true;
}

/** True when a pause (comma, colon, full stop...) separates token a from token b in the text. */
function pauseBetween(text: string, a: Token, b: Token): boolean {
  return /[,.;:!?()]/.test(text.slice(a.end, b.start));
}

const matchesAny = (words: string[], tok: string) => words.some((w) => similarity(w, tok) >= FUZZY_MIN);

/** Does the text deny one of the point's words? A verbal negation reaches up to 5 tokens in its clause; a nominal one only its noun. */
function deniesPointWords(text: string, toks: Token[], pointWords: string[]): boolean {
  for (let i = 0; i < toks.length; i++) {
    if (!negates(toks, i)) continue;
    const nominal = NOMINAL_NEGATIONS.has(toks[i].norm);
    for (let k = i + 1; k <= i + SCOPE && k < toks.length; k++) {
      if (pauseBetween(text, toks[k - 1], toks[k]) || SCOPE_END.has(toks[k].norm)) break;
      if (matchesAny(pointWords, toks[k].norm)) return true;
      if (nominal && /^\p{L}{3,}$/u.test(toks[k].norm) && !NOT_A_NOUN.has(toks[k].norm)) break; // "no customer complained": the noun was not ours
    }
  }
  return false;
}
const NOT_A_NOUN = new Set(["the", "our", "any", "more", "one", "il", "lo", "la", "gli", "le", "dei", "delle", "degli", "nostro", "nostra", "nostri", "nostre", "piu"]);

/** Clauses of a sentence (split at pauses and at "while", "mentre", "but", "ma"), as token ranges. */
function clauses(text: string, toks: Token[]): Token[][] {
  const out: Token[][] = [];
  let cur: Token[] = [];
  toks.forEach((t, i) => {
    const cut = i > 0 && (pauseBetween(text, toks[i - 1], t) || ["while", "whereas", "mentre", "but", "ma", "invece"].includes(t.norm));
    if (cut && cur.length) {
      out.push(cur);
      cur = [];
    }
    cur.push(t);
  });
  if (cur.length) out.push(cur);
  return out;
}

const label = (q: Quantity) => `${Number.isInteger(q.raw) ? q.raw : q.raw.toFixed(2)}${q.kind === "percent" ? "%" : q.kind === "duration" ? ` (${+(q.value / 3600).toFixed(2)} h)` : q.kind.startsWith("currency:") ? ` ${q.kind.slice(9)}` : ""}`;
const klass = (q: Quantity) => (q.kind.startsWith("currency:") ? "currency" : q.kind);

type Claim = {
  words: string[];
  /** content words that are not direction words: the point's subject ("costs", "onboarding time") */
  anchors: string[];
  quantities: Quantity[];
  direction: "up" | "down" | null;
  negated: boolean;
};

function claimOf(point: string): Claim {
  const toks = tokenize(point);
  const words = contentTokens(point);
  const dirs = new Set(toks.map((_, i) => directionAt(toks, i)).filter(Boolean) as Array<"up" | "down">);
  return {
    words,
    anchors: words.filter((w) => !UP.test(w) && !DOWN.test(w)),
    quantities: quantitiesFromTokens(toks).filter((q) => q.kind !== "year"),
    direction: dirs.size === 1 ? [...dirs][0] : null,
    negated: toks.some((_, i) => negates(toks, i)),
  };
}

type Reading = { conflict?: GuardConflict; carriesClaim: boolean; anchored: boolean };

/** How one sentence relates to the point: a conflict, a statement of the claim, or neither. */
function read(claim: Claim, sentence: string): Reading {
  const st = tokenize(sentence);
  const anchored = st.some((t) => matchesAny(claim.anchors, t.norm));
  const parts = clauses(sentence, st);
  const about = parts.filter((c) => c.some((t) => matchesAny(claim.anchors.length ? claim.anchors : claim.words, t.norm)));
  const scope = about.length ? about : parts;

  // numbers and units, per class: a conflict only when the speech has numbers of a class and none of the point's numbers of that class
  const sq = quantitiesFromTokens(st).filter((q) => q.kind !== "year");
  let numberSupport = false;
  for (const cls of new Set(claim.quantities.map(klass))) {
    const mine = claim.quantities.filter((q) => klass(q) === cls);
    const theirs = sq.filter((q) => klass(q) === cls);
    if (!theirs.length) {
      const other = sq.find((s) => s.kind !== "count" && mine.some((q) => s.raw === q.raw));
      if (other) return { conflict: { kind: "unit", detail: `point says ${mine.map(label).join(", ")}, speech says ${label(other)}` }, carriesClaim: true, anchored };
      continue;
    }
    if (mine.some((q) => theirs.some((s) => sameQuantity(q, s)))) numberSupport = true;
    else return { conflict: { kind: "number", detail: `point says ${mine.map(label).join(", ")}, speech says ${theirs.map(label).join(", ")}` }, carriesClaim: true, anchored };
  }

  // negation: an affirmative point denied in the speech, or a negated point said with no negation in its clauses
  if (!claim.negated && deniesPointWords(sentence, st, claim.words)) return { conflict: { kind: "negation", detail: "the speech denies the point" }, carriesClaim: true, anchored };
  if (claim.negated) {
    const said = scope.some((c) => c.some((t) => t.norm === "senza" || t.norm === "without" || negates(st, st.indexOf(t))));
    if (!said) return { conflict: { kind: "negation", detail: "the point is a negation, the speech is not" }, carriesClaim: true, anchored };
  }

  // direction, in the clauses about the point's subject: "revenue jumped while costs dropped"
  let directionSupport = false;
  if (claim.direction) {
    const sd = new Set<string>();
    for (const c of scope) for (const t of c) {
      const d = directionAt(st, st.indexOf(t));
      if (d) sd.add(d);
    }
    if (sd.size && !sd.has(claim.direction)) return { conflict: { kind: "direction", detail: `point says ${claim.direction}, speech says ${[...sd][0]}` }, carriesClaim: true, anchored };
    directionSupport = sd.has(claim.direction);
  }

  // Does this sentence state the claim itself (its number or its direction), or only mention the topic?
  const carriesClaim = claim.quantities.length ? numberSupport : claim.direction ? directionSupport : true;
  return { carriesClaim, anchored };
}

/** Kept for callers that only need the first explicit conflict between a point and one sentence. */
export function conflictBetween(point: string, sentence: string): GuardConflict | undefined {
  return read(claimOf(point), sentence).conflict;
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
const round = (x: number) => Math.round(x * 100) / 100;

/**
 * Checks a point against the transcript the decision was made on. Sentences about the point are those
 * sharing at least a third of its content words, or one of its numbers. Among them, the latest one that
 * states the claim decides: a contradiction there (sharing the point's subject words) blocks the
 * point, a statement of the claim (its number, its direction, or the point itself when it has neither)
 * passes it and is the evidence. A sentence that only mentions the topic ("let's talk about costs")
 * decides nothing. With no sentence stating the claim, the point passes on the best-covered sentence:
 * a paraphrase is the decision model's call.
 */
export function checkClaim(point: string, transcript: string): ClaimCheck {
  const claim = claimOf(point);
  const scored = sentences(transcript).map((s) => {
    const toks = tokenize(s.text);
    const lexical = coverage(claim.words, toks);
    const sq = quantitiesFromTokens(toks);
    const numberMatch = claim.quantities.some((q) => sq.some((x) => sameQuantity(q, x)));
    return { s, lexical, relevance: Math.min(1, lexical + (numberMatch ? 0.5 : 0)) };
  });
  const relevant = scored.filter((x) => x.relevance >= MIN_RELEVANT);
  for (let i = relevant.length - 1; i >= 0; i--) {
    const x = relevant[i];
    const r = read(claim, x.s.text);
    if (r.conflict && (r.anchored || !claim.anchors.length)) return { ok: false, evidence: x.s, lexical: round(x.lexical), conflict: r.conflict };
    if (!r.conflict && r.carriesClaim) return { ok: true, evidence: x.s, lexical: round(x.lexical) };
  }
  const top = scored.reduce<(typeof scored)[number] | null>((a, x) => (!a || x.relevance > a.relevance || (x.relevance === a.relevance && x.lexical >= a.lexical) ? x : a), null);
  return { ok: true, evidence: top && top.relevance > 0 ? top.s : null, lexical: round(top?.lexical ?? 0) };
}
