// Re-anchoring: the presenter tells Filow where they are during a take (a click on a point or a
// section, a presentation clicker, or saying a section's name). Pure helpers, no DOM: the engine's
// "anchor" command (engine.ts) does the move; these decide which move an input means.
import { contentTokens, fold, similarity, tokenize, FUZZY_MIN } from "./text";
import type { SessionState } from "./types";

export type ClickerMove = "next" | "prev";

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
 * Words that announce a move to another part of the talk (en, it, ru, ro), folded. Only words that
 * rarely sit before a topic in passing: "to" or "about" alone are not cues ("this relates to pricing").
 */
const CUES = new Set([
  "now", "next", "section", "part", "move", "moving", "go", "back", "turn",
  "ora", "adesso", "passiamo", "passo", "sezione", "parte", "torniamo", "torno", "andiamo", "prossima", "vediamo",
  "теперь", "далее", "дальше", "раздел", "часть", "перейдем", "переходим", "вернемся",
  "acum", "sectiunea", "sectiune", "partea", "trecem", "mergem", "revenim", "urmeaza",
]);

/** How far into an utterance a section name may start and still read as an announcement ("Now let's talk about pricing"). */
const LEAD_TOKENS = 6;
/** How many words before a name are searched for a cue ("let's move on to pricing"). */
const CUE_LOOKBACK = 4;
/** Extra words allowed inside a spoken name ("pricing and the plans" for "Pricing and plans"). */
const SLACK = 2;

/** The names a section can be called by: its whole title and, for "Label - Title", each half. */
function names(title: string): string[][] {
  const out = [title];
  const sep = title.indexOf(" - ");
  if (sep > 0) out.push(title.slice(0, sep), title.slice(sep + 3));
  return out.map((n) => [...new Set(contentTokens(n))]).filter((n) => n.length > 0);
}

/**
 * Where, in the utterance's tokens, the name's content words appear in order within a short run.
 * Returns the index of the first matched token, or -1.
 */
function findName(words: string[], name: string[]): number {
  const maxRun = name.length + SLACK;
  for (let i = 0; i < words.length; i++) {
    if (similarity(words[i], name[0]) < FUZZY_MIN) continue;
    let k = 1;
    let j = i + 1;
    while (k < name.length && j < words.length && j - i < maxRun) {
      if (similarity(words[j], name[k]) >= FUZZY_MIN) k++;
      j++;
    }
    if (k === name.length) return i;
  }
  return -1;
}

/**
 * Whether a name found at word `at` reads as an announcement, not a passing mention:
 * - a cue word comes just before it, or anywhere before it when it opens the utterance ("Now let's talk about pricing");
 * - or the utterance is little more than the name ("Pricing.", "OK, pricing now");
 * - or a name of two or more words opens the utterance ("Budget review: ..."; not "The budget review showed").
 */
function announced(words: string[], at: number, nameLen: number): boolean {
  const cueFrom = at < LEAD_TOKENS ? 0 : Math.max(0, at - CUE_LOOKBACK);
  if (words.slice(cueFrom, at).some((w) => CUES.has(fold(w)))) return true;
  if (words.length <= nameLen + SHORT_EXTRA) return true;
  return nameLen >= 2 && at === 0;
}

/** Words beside the name that still make an utterance "just the name". */
const SHORT_EXTRA = 3;

/**
 * The section the presenter just named, or null. A short local match, no model: a committed
 * utterance names a section when the content words of the section's title (or of one half of a
 * "Label - Title" heading) appear in order in a short run and the run reads as an announcement (see
 * announced()). The current section is never returned. When two sections match, the one with the
 * longer name wins, then the nearest one after the current section. So "Pricing." or "Now let's talk
 * about pricing" moves to "Pricing", while "the pricing model we chose" does not.
 */
export function spokenSection(utterance: string, titles: readonly string[], current: number): number | null {
  const words = tokenize(utterance).map((t) => t.norm);
  if (!words.length) return null;
  const n = titles.length;
  /** distance going forward from the current section, wrapping: the next section is nearest */
  const ahead = (i: number) => (i - current + n) % n;
  let bestIdx = -1;
  let bestLen = 0;
  for (let idx = 0; idx < n; idx++) {
    if (idx === current) continue;
    for (const name of names(titles[idx])) {
      const at = findName(words, name);
      if (at < 0) continue;
      if (!announced(words, at, name.length)) continue;
      if (bestIdx < 0 || name.length > bestLen || (name.length === bestLen && ahead(idx) < ahead(bestIdx))) {
        bestIdx = idx;
        bestLen = name.length;
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
