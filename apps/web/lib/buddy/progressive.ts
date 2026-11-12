import { splitSentences } from "./turn";

/** Speak completed sentences in order while the model is still producing the answer.
 * The parser supplies plain text; protocol tags and incomplete visual blocks never reach speech.
 * A turn owns its queue: cancellation prevents queued audio from starting after Stop or an error.
 * This is the answer's one speech queue: each chunk is told where its sentences sit in the whole
 * answer (`base`, counted with turn.ts splitSentences, as the pill and the bubble count them), and a
 * paused answer (`unpaused`, turn.ts) starts no new chunk until Resume.
 */
export function createProgressiveSpeech(options: {
  /** Says one chunk. `base`: how many sentences of the answer come before it. */
  speak: (text: string, base: number) => Promise<void>;
  isCurrent: () => boolean;
  /** Resolves true at once when the answer is not paused, else on Resume; false when it ended meanwhile (turn.ts unpaused). */
  unpaused?: () => Promise<boolean>;
  /** The start of the answer that was already heard (Resume after Stop): the voice carries on after it. */
  said?: string;
}) {
  let committed = options.said ?? "";
  /** Sentences handed to the queue so far, and the ones heard whole. */
  let base = splitSentences(committed).length;
  let heard = base;
  /** The latest text given to update(), with the part not yet handed to the queue. */
  let latest = committed;
  /** Chunks queued and not started yet, and the one being spoken (its first sentence's index). */
  const waiting: string[] = [];
  let current: { text: string; at: number; count: number } | null = null;
  let cancelled = false;
  let queue = Promise.resolve();
  const live = () => !cancelled && options.isCurrent();
  function push(text: string) {
    const chunk = text.trim();
    if (!chunk) return;
    const at = base;
    const count = splitSentences(chunk).length;
    base += count;
    waiting.push(chunk);
    queue = queue.then(async () => {
      if (!live()) return;
      // Paused: the next chunk waits for Resume, and never starts when the answer ended meanwhile.
      if (options.unpaused && !(await options.unpaused())) return;
      if (!live()) return;
      waiting.shift();
      current = { text: chunk, at, count };
      await options.speak(chunk, at);
      // Cut by a stop: `current` stays, where() asks the voice how far into it the user heard.
      if (!live()) return;
      heard = at + count;
      current = null;
    });
    // Attach immediately: a failed voice must not become an unhandled rejection while reading.
    void queue.catch(() => {});
  }
  /** `more`: the model already wrote something after `text` that is not shown (moreFollows). */
  function update(text: string, final = false, more = false) {
    if (!live()) return;
    latest = text;
    if (!text.startsWith(committed)) {
      // The parser rewrote something already said (a tag the model closed late). Mid-answer, wait.
      // At the end say what is left: the rest of the answer must never be dropped in silence.
      if (!final) return;
      let same = 0;
      while (same < committed.length && committed[same] === text[same]) same++;
      const gap = text.slice(same).search(/\s/);
      committed = text;
      if (gap >= 0) push(text.slice(same + gap));
      return;
    }
    const rest = text.slice(committed.length);
    let end = final ? rest.length : 0;
    if (!final) {
      // A full stop that only ends the network chunk is not a sentence end yet ("example." + "com",
      // "Wait." + ".."): Latin punctuation counts once the next word has started. 。！？ end at once.
      for (const match of rest.matchAll(/[.!?。！？]+["'”’)]*(?=\s|[\u3000-\u9fff])|[\u3002\uff01\uff1f]+[\u201d\u2019\u300d\u300f\uff09]*/gu)) {
        const before = rest.slice(0, match.index + 1);
        // A decimal or common title may arrive split across network chunks.
        if (match[0] === "." && /(?:\d|\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)|\b[A-Z])\.$/i.test(before)) continue;
        end = match.index + match[0].length;
      }
      // The text ends in a full stop and the model has moved on (a line break, a tag or a picture's
      // block being written): the sentence is over, it must not wait for the whole picture.
      const tail = more ? /[.!?]+["'”’)]*$/u.exec(rest) : null;
      if (tail && !(tail[0] === "." && /(?:\d|\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)|\b[A-Z])\.$/i.test(rest))) end = rest.length;
    }
    if (!end) return;
    committed += rest.slice(0, end);
    push(rest.slice(0, end));
  }
  return {
    update,
    finish(text: string) { update(text, true); return queue; },
    cancel() { cancelled = true; },
    /**
     * How far the user heard the answer, for a Resume after Stop: `heard` sentences whole, and the
     * text not heard yet (`left`). `chunkLeft`: what the voice did not say of the chunk it was on
     * (voice.ts left()).
     */
    where(chunkLeft: string): { heard: number; left: string } {
      const rest = latest.startsWith(committed) ? latest.slice(committed.length) : "";
      const tail = [...waiting, rest].map((s) => s.trim()).filter(Boolean);
      if (!current) return { heard, left: tail.join(" ") };
      const unsaid = chunkLeft.trim();
      return { heard: current.at + current.count - splitSentences(unsaid).length, left: [unsaid, ...tail].filter(Boolean).join(" ") };
    },
  };
}
export type ProgressiveSpeech = ReturnType<typeof createProgressiveSpeech>;

/**
 * True when the streamed answer `raw` already goes on after its shown `text`: white space, or
 * something the parser holds back (a tag or a model3d/drawing2d block still being written). A full
 * stop at the end of `text` is then a finished sentence, not the middle of "example.com".
 */
export function moreFollows(raw: string, text: string): boolean {
  return text !== "" && !raw.endsWith(text.slice(-12));
}
