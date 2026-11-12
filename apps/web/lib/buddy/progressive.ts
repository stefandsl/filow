/** Speak completed sentences in order while the model is still producing the answer.
 * The parser supplies plain text; protocol tags and incomplete visual blocks never reach speech.
 * A turn owns its queue: cancellation prevents queued audio from starting after Stop or an error.
 */
export function createProgressiveSpeech(options: {
  speak: (text: string) => Promise<void>;
  isCurrent: () => boolean;
}) {
  let committed = "";
  let cancelled = false;
  let queue = Promise.resolve();
  const live = () => !cancelled && options.isCurrent();
  function push(text: string) {
    if (!text.trim()) return;
    queue = queue.then(async () => { if (live()) await options.speak(text.trim()); });
    // Attach immediately: a failed voice must not become an unhandled rejection while reading.
    void queue.catch(() => {});
  }
  function update(text: string, final = false) {
    if (!live() || !text.startsWith(committed)) return;
    const rest = text.slice(committed.length);
    let end = final ? rest.length : 0;
    if (!final) {
      for (const match of rest.matchAll(/[.!?。！？]+["'”’)]*(?=\s|$|[\u3000-\u9fff])/gu)) {
        const before = rest.slice(0, match.index + 1);
        // A decimal or common title may arrive split across network chunks.
        if (match[0] === "." && /(?:\d|\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)|\b[A-Z])\.$/i.test(before)) continue;
        end = match.index + match[0].length;
      }
    }
    if (!end) return;
    committed += rest.slice(0, end);
    push(rest.slice(0, end));
  }
  return {
    update,
    finish(text: string) { update(text, true); return queue; },
    cancel() { cancelled = true; },
  };
}
