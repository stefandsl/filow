// A question that plainly asks for a drawing or a 3D model ("draw a car", in the five languages) gets
// one: the model is asked with a prompt about drawing only, and its picture is held back until it is
// known to be usable. When it is not (small local models refuse, describe the picture in words or
// write back the prompt's example) the model is asked once more, within a time limit. The user never
// reads "I can't draw": when both tries fail the answer says so plainly, in their language.
//
// The spoken sentence goes out as soon as the model starts the picture's block: by then it has
// committed to drawing, and on a slow computer the user hears the answer start within a second or two
// instead of waiting in silence for the whole picture (measured: G:/FILOW/tmp/v17-parity/FINDINGS.md).
import { BUDDY_LANG_NAMES, buddyLang } from "./lang";
import type { AskShape } from "./providers";
import { okfText } from "./text";
import { drawOnlyPrompt, extractVisuals, type DrawKind } from "./visuals";

/** How long the first try may take (a drawing takes 20 to 30 s on an 8 GB graphics card), and the second before the answer gives up on the picture. */
export const DRAW_FIRST_MS = 90_000;
export const DRAW_RETRY_MS = 45_000;

/** True when the answer carries a drawing or a model the app can show. */
export function hasPicture(raw: string): boolean {
  const v = extractVisuals(raw, () => true);
  return Boolean(v.model || v.drawing);
}

const FENCE = /```\s*(?:drawing2d|model3d)/i;
/** A sentence that says it cannot, or is sorry: never said early, even when a block follows it. */
const CANNOT = /can(?:'|’)?t|cannot|unable|sorry|non posso|non riesco|mi dispiace|scusa|не могу|извин|к сожалению|nu pot|[îi]mi pare r[ăa]u|scuze|できません|すみません|申し訳/i;
/**
 * Where the picture's block starts, when what comes before it is a sentence fit to be said at once:
 * some words, no tag in square brackets, not a wall of text. -1 otherwise (the reply is then held whole).
 */
export function spokenBeforeBlock(raw: string): number {
  const at = raw.search(FENCE);
  if (at < 0) return -1;
  const said = raw.slice(0, at);
  return said.trim().length >= 2 && said.length <= 300 && !/[[\]`]/.test(said) && !CANNOT.test(said) ? at : -1;
}

export type DrawAsk = (shape: AskShape, signal: AbortSignal) => AsyncIterable<string>;

/**
 * The answer to a draw request: the spoken sentence, then the picture (nothing of a try without a
 * picture is shown, except a sentence that was already said). `ask` calls the provider with the given
 * prompt; `signal` is the user's Stop (or a closed page): once it fires nothing more is asked and
 * nothing is yielded.
 */
export async function* drawnAnswer(ask: DrawAsk, opts: { kind: DrawKind; language: string; lang: string; signal: AbortSignal; firstMs?: number; retryMs?: number }): AsyncGenerator<string> {
  const code = buddyLang(opts.language);
  const name = code ? BUDDY_LANG_NAMES[code] : "the language the user speaks";
  // The screenshots stay out: a picture of a thing needs none, and they pull small models off the task.
  const shape = (again: boolean): AskShape => ({ system: drawOnlyPrompt(opts.kind, name, again), pictures: false });
  // The first try has a limit too: a small model that loops must not keep the user waiting for minutes.
  const firstLimit = AbortSignal.any([opts.signal, AbortSignal.timeout(opts.firstMs ?? DRAW_FIRST_MS)]);
  let first = "";
  /** How much of the first reply was already given to the user (its spoken sentence). */
  let said = 0;
  try {
    for await (const piece of ask(shape(false), firstLimit)) {
      first += piece;
      if (!said && !opts.signal.aborted) {
        const at = spokenBeforeBlock(first);
        if (at > 0) {
          said = at;
          yield first.slice(0, at);
        }
      }
    }
  } catch (e) {
    if (opts.signal.aborted) return;
    // Out of time counts as "no picture"; anything else (Ollama not running, no consent) is the answer's error.
    if (!firstLimit.aborted) throw e;
  }
  if (opts.signal.aborted) return;
  if (hasPicture(first)) return void (yield first.slice(said));
  let second = "";
  try {
    for await (const piece of ask(shape(true), AbortSignal.any([opts.signal, AbortSignal.timeout(opts.retryMs ?? DRAW_RETRY_MS)]))) second += piece;
  } catch (e) {
    // The time limit, or the provider failing on the second try: the answer below says the picture did not come.
    if (opts.signal.aborted) return;
    if (!(e instanceof Error)) throw e;
  }
  if (opts.signal.aborted) return;
  if (!hasPicture(second)) return void (yield (said ? "\n" : "") + okfText(opts.lang)("drawFailed"));
  // A sentence was already said for the first try: only the picture of the second one follows it.
  const at = said ? second.search(FENCE) : 0;
  yield second.slice(Math.max(0, at));
}
