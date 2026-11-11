// A setup may answer with one model and place the points with another (setupChoices: screenHelper.pointer).
// Gemma 4 E4B reads the screen and answers well, but its [POINT] tags landed 40 to 70 pixels off
// (2 of 22 inside the target); lfm3-vl, asked only where a named thing is, placed 20 of 22
// (G:/FILOW/tmp/v17-parity/FINDINGS.md). So the answer's own POINT tags are taken out as it streams,
// and when it has ended the pointing model is asked for each named thing; its tags follow the answer.
// Both calls stay on this PC and end with the same Stop signal.

/** In a question: the reply must be the tag alone (the page's own follow-up uses the same words, and prompt.ts adds no screen note to it). */
export const POINT_ONLY = "[POINT:x,y:label:screenN]";
export const isPointOnly = (question: string): boolean => question.includes(POINT_ONLY);

/** The narrow question for one thing the answer named. */
export const pointQuestion = (label: string): string =>
  `Where is "${label}" on the screen? Reply with only the tag ${POINT_ONLY} for that thing, on the 0-1000 grid, and nothing else. If it is not visible, reply NONE.`;

const POINT_TAG = /\[POINT:\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*(?::([^[\]]*?))?(?::\s*screen\s*(\d+))?\s*\]/gi;
/** "[", "[PO", "[POINT:12,3": a POINT tag that may still be on its way at the end of a piece. */
const POINT_START = /^\[(?:P(?:O(?:I(?:N(?:T(?::[^[\]]*)?)?)?)?)?)?$/i;
export const MAX_POINTS = 3;

/**
 * The answer without its own POINT tags, followed by the pointing model's tag for each thing those
 * tags named (at most three, each once). `ground(label)` asks the pointing model and returns its
 * reply; a reply without a usable tag ("NONE", an error) adds nothing. Other marks ([BOX], [CARD],
 * drawings) pass through untouched.
 */
export async function* withPointer(answer: AsyncIterable<string>, ground: (label: string) => Promise<string>, stopped: () => boolean = () => false): AsyncGenerator<string> {
  const labels: Array<{ label: string; screen: string }> = [];
  const take = (text: string) =>
    text.replace(POINT_TAG, (_m, label: string | undefined, screen: string | undefined) => {
      const l = (label ?? "").trim().slice(0, 60);
      if (l && labels.length < MAX_POINTS && !labels.some((x) => x.label.toLowerCase() === l.toLowerCase())) labels.push({ label: l, screen: screen ?? "" });
      return "";
    });
  let held = "";
  for await (const piece of answer) {
    held = take(held + piece);
    // An unfinished tag at the end waits for the rest of it; everything before it goes out now.
    const open = held.lastIndexOf("[");
    const keep = open >= 0 && POINT_START.test(held.slice(open)) ? open : held.length;
    if (keep > 0) yield held.slice(0, keep);
    held = held.slice(keep);
  }
  // A tag the model never closed is not shown.
  if (held && !POINT_START.test(held)) yield held;
  for (const { label, screen } of labels) {
    if (stopped()) return;
    let reply = "";
    try {
      reply = await ground(label);
    } catch {
      continue;
    }
    if (stopped()) return;
    const m = /\[POINT:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?::[^[\]]*?)?(?::\s*screen\s*(\d+))?\s*\]/i.exec(reply);
    if (!m) continue;
    const [x, y] = [Number(m[1]), Number(m[2])];
    if (!(x >= 0 && x <= 1000 && y >= 0 && y <= 1000)) continue;
    // The answering model's own words for the thing; the screen the pointing model found it on, else the one the answer named.
    const on = m[3] ?? screen;
    yield ` [POINT:${Math.round(x)},${Math.round(y)}:${label}${on ? `:screen${on}` : ""}]`;
  }
}
