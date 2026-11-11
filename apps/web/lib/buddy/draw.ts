// A question that plainly asks for a drawing or a 3D model ("draw a car", in the five languages) gets
// one: the model is asked with a prompt about drawing only, its reply is held back until it is known
// to carry a usable picture, and when it does not (small local models refuse, describe the picture
// in words or write back the prompt's example) it is asked once more, within a time limit. The user
// never reads "I can't draw": when both tries fail the answer says so plainly, in their language.
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

export type DrawAsk = (shape: AskShape, signal: AbortSignal) => AsyncIterable<string>;

/**
 * The answer to a draw request, whole (nothing of a try without a picture is ever shown).
 * `ask` calls the provider with the given prompt; `signal` is the user's Stop (or a closed page):
 * once it fires nothing more is asked and nothing is yielded.
 */
export async function* drawnAnswer(ask: DrawAsk, opts: { kind: DrawKind; language: string; lang: string; signal: AbortSignal; firstMs?: number; retryMs?: number }): AsyncGenerator<string> {
  const code = buddyLang(opts.language);
  const name = code ? BUDDY_LANG_NAMES[code] : "the language the user speaks";
  const attempt = async (again: boolean, signal: AbortSignal): Promise<string> => {
    let said = "";
    // The screenshots stay out: a picture of a thing needs none, and they pull small models off the task.
    for await (const piece of ask({ system: drawOnlyPrompt(opts.kind, name, again), pictures: false }, signal)) said += piece;
    return said;
  };
  // The first try has a limit too: a small model that loops must not keep the user waiting for minutes.
  const firstLimit = AbortSignal.any([opts.signal, AbortSignal.timeout(opts.firstMs ?? DRAW_FIRST_MS)]);
  let first = "";
  try {
    first = await attempt(false, firstLimit);
  } catch (e) {
    if (opts.signal.aborted) return;
    // Out of time counts as "no picture"; anything else (Ollama not running, no consent) is the answer's error.
    if (!firstLimit.aborted) throw e;
  }
  if (opts.signal.aborted) return;
  if (hasPicture(first)) return void (yield first);
  let second = "";
  try {
    second = await attempt(true, AbortSignal.any([opts.signal, AbortSignal.timeout(opts.retryMs ?? DRAW_RETRY_MS)]));
  } catch (e) {
    // The time limit, or the provider failing on the second try: the answer below says the picture did not come.
    if (opts.signal.aborted) return;
    if (!(e instanceof Error)) throw e;
  }
  if (opts.signal.aborted) return;
  yield hasPicture(second) ? second : okfText(opts.lang)("drawFailed");
}
