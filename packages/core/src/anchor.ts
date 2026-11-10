// Re-anchoring: the presenter tells Filow where they are during a take (a click on a point or a
// section, a presentation clicker, or saying a section's name). Pure helpers, no DOM: the engine's
// "anchor" command (engine.ts) does the move; these decide which move an input means.
import { contentTokens, quantities, similarity, tokenize, FUZZY_MIN } from "./text";
import type { Command, SessionState } from "./types";

export type ClickerMove = "next" | "prev";

/**
 * The anchor command for a Next / Previous move (button, clicker key, tap) from `state`, or null at
 * either end of the script. Next keeps the words said just before it: people often start the next
 * part, then press. Previous does not: what was said since is about the later part.
 */
export function moveCommand(state: Pick<SessionState, "script" | "sectionIdx">, move: ClickerMove): Command | null {
  const idx = state.sectionIdx + (move === "next" ? 1 : -1);
  if (idx < 0 || idx >= state.script.sections.length) return null;
  return move === "next" ? { type: "anchor", idx, keep: "recent" } : { type: "anchor", idx };
}

/**
 * The keys a presentation clicker sends, read as a section move: PageDown / PageUp (most clickers),
 * Right / Left arrows (clickers in keyboard mode). Anything else is not a move, B and "." included:
 * they black or white the screen in a slide show and must keep doing only that. A key with Ctrl, Alt
 * or Meta held is a shortcut, not a clicker.
 */
export function clickerMove(e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }): ClickerMove | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  switch (e.key) {
    case "PageDown":
    case "ArrowRight":
      return "next";
    case "PageUp":
    case "ArrowLeft":
      return "prev";
    default:
      return null;
  }
}

/**
 * Words that announce a move to another part of the talk (en, it, ru, ro, ja), folded. Only words that
 * rarely sit before a topic in passing: "to" or "about" alone are not cues ("this relates to pricing"),
 * nor are "part" / "parte", which are often the name itself ("Parte 2") and an idiom ("da parte nostra").
 */
const CUES = new Set([
  "now", "next", "section", "move", "moving", "go", "back", "turn",
  "ora", "adesso", "passiamo", "passo", "sezione", "torniamo", "torno", "andiamo", "prossima", "vediamo",
  "теперь", "далее", "дальше", "раздел", "перейдем", "переходим", "вернемся",
  "acum", "sectiunea", "sectiune", "trecem", "mergem", "revenim", "urmeaza",
  "次", "次は", "次に", "では", "それでは", "続いて", "移ります",
]);
/** Words that carry nothing ("OK, pricing now"): they do not make an utterance more than the name. */
const FILLERS = new Set(["ok", "okay", "well", "right", "allora", "bene", "ecco", "dunque", "quindi", "ну", "итак", "так", "deci", "bun", "bine"]);

/** How far into an utterance a section name may start and still follow a cue said before it ("Now let's talk about pricing"). */
const LEAD_TOKENS = 6;
/** How many words before a name are searched for a cue ("let's move on to pricing"). */
const CUE_LOOKBACK = 4;
/** Extra words allowed inside a spoken name ("pricing and the plans" for "Pricing and plans"). */
const SLACK = 2;
/** What a cued name may still be followed by ("Now, pricing: we have three tiers"), not a whole sentence about it: content words, all words. */
const AFTER_MAX = 1;
const AFTER_WORDS_MAX = 4;

type Name = { words: string[]; numbers: number[] };

/** The names a section can be called by: its whole title and, for "Label - Title", each half; numbers kept apart. */
function names(title: string): Name[] {
  const out = [title];
  const sep = title.indexOf(" - ");
  if (sep > 0) out.push(title.slice(0, sep), title.slice(sep + 3));
  return out
    .map((n) => ({ words: [...new Set(contentTokens(n))], numbers: quantities(n).map((q) => q.raw) }))
    .filter((n) => n.words.length > 0);
}

const CYRILLIC = /^\p{Script=Cyrillic}+$/u;
/**
 * Fuzzy match of a spoken word to a word of a name. On top of similarity() (text.ts), Russian case
 * endings: words that share all but their last two letters, at least three ("ценах" ~ "цены",
 * "планам" ~ "планы").
 */
function sameWord(a: string, b: string): boolean {
  if (similarity(a, b) >= FUZZY_MIN) return true;
  if (!CYRILLIC.test(a) || !CYRILLIC.test(b)) return false;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p >= Math.max(3, Math.min(a.length, b.length) - 2);
}

/**
 * Where, in the utterance's tokens, the name's content words appear in order within a short run.
 * Returns [first matched token, index after the last one], or null.
 */
function findName(words: string[], name: string[]): [number, number] | null {
  const maxRun = name.length + SLACK;
  for (let i = 0; i < words.length; i++) {
    if (!sameWord(words[i], name[0])) continue;
    let k = 1;
    let j = i + 1;
    while (k < name.length && j < words.length && j - i < maxRun) {
      if (sameWord(words[j], name[k])) k++;
      j++;
    }
    if (k === name.length) return [i, j];
  }
  return null;
}

const isCue = (w: string) => CUES.has(w);
const isContent = (w: string) => !isCue(w) && !FILLERS.has(w) && contentTokens(w).length > 0;

/**
 * Whether a name found at words [at, end) reads as an announcement, not a passing mention:
 * - the utterance says nothing but the name, cue words and fillers ("Pricing.", "OK, pricing now");
 * - or a cue word comes just before the name, or anywhere before it when the name is near the start,
 *   and only a few words follow (AFTER_MAX, AFTER_WORDS_MAX: "Now let's talk about pricing", "Now, pricing: three
 *   tiers"), not "Now the pricing went down a lot this year".
 */
function announced(words: string[], at: number, end: number): boolean {
  const extras = words.filter((w, i) => (i < at || i >= end) && isContent(w)).length;
  if (extras === 0) return true;
  const cueFrom = at < LEAD_TOKENS ? 0 : Math.max(0, at - CUE_LOOKBACK);
  if (!words.slice(cueFrom, at).some(isCue)) return false;
  const after = words.slice(end);
  return after.length <= AFTER_WORDS_MAX && after.filter(isContent).length <= AFTER_MAX;
}

/**
 * The section the presenter just named, or null. A short local match, no model: a committed
 * utterance names a section when the content words of the section's title (or of one half of a
 * "Label - Title" heading) appear in order in a short run, any number in that name is said too
 * ("parte tre" for "Parte 3"), and the run reads as an announcement (see announced()). The current
 * section is never returned. When two sections match, the one with the longer name wins, then the
 * nearest one after the current section. So "Pricing." or "Now let's talk about pricing" moves to
 * "Pricing", while "the pricing is high" or "the pricing model we chose" does not.
 */
export function spokenSection(utterance: string, titles: readonly string[], current: number): number | null {
  const words = tokenize(utterance).map((t) => t.norm);
  if (!words.length) return null;
  const said = new Set(quantities(utterance).map((q) => q.raw));
  const n = titles.length;
  /** distance going forward from the current section, wrapping: the next section is nearest */
  const ahead = (i: number) => (i - current + n) % n;
  const all = titles.map(names);
  /** another section has a name with the same words ("Parte 1" and "Parte 2"): only its number tells them apart */
  const shared = (idx: number, name: Name) => all.some((other, j) => j !== idx && other.some((o) => o.words.join(" ") === name.words.join(" ")));
  let bestIdx = -1;
  let bestLen = 0;
  for (let idx = 0; idx < n; idx++) {
    if (idx === current) continue;
    for (const name of all[idx]) {
      // "parte tre" picks "Parte 3"; "the roadmap" still picks "Roadmap 2027" when no other section is a roadmap
      if (name.numbers.length && (said.size ? !name.numbers.every((x) => said.has(x)) : shared(idx, name))) continue;
      const run = findName(words, name.words);
      if (!run || !announced(words, run[0], run[1])) continue;
      const len = name.words.length + name.numbers.length;
      if (bestIdx < 0 || len > bestLen || (len === bestLen && ahead(idx) < ahead(bestIdx))) {
        bestIdx = idx;
        bestLen = len;
      }
    }
  }
  return bestIdx < 0 ? null : bestIdx;
}
/**
 * The point the presenter is on in the current section: the first point not yet said at or after the
 * point they anchored to (state.here), else the first point not yet said. null when every point of
 * the section is said. Drives the "you are here" mark and the eyeline.
 */
export function currentPoint(state: Pick<SessionState, "script" | "sectionIdx" | "points" | "here">): string | null {
  const section = state.script.sections[state.sectionIdx];
  if (!section) return null;
  const open = (id: string) => state.points[id]?.status !== "started";
  const from = state.here ? section.bullets.findIndex((b) => b.id === state.here) : -1;
  if (from >= 0) {
    const after = section.bullets.slice(from).find((b) => open(b.id));
    if (after) return after.id;
  }
  return section.bullets.find((b) => open(b.id))?.id ?? null;
}
