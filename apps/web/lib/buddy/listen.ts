// OK Filow listening helpers: pure, unit tested (buddy.test.ts).

/** One highlighter stroke the user drew while asking, on the 0-1000 grid of a screen. */
export type MarkedStroke = { screen: number; points: Array<[number, number]> };

/** Bounding box of each stroke, in words the model can use alongside the marked screenshot. */
export function describeMarked(marked: MarkedStroke[]): string {
  const boxes = marked
    .filter((m) => m.points.length > 1)
    .map((m) => {
      const xs = m.points.map((p) => p[0]);
      const ys = m.points.map((p) => p[1]);
      const c = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
      return `screen${m.screen} from ${c(Math.min(...xs))},${c(Math.min(...ys))} to ${c(Math.max(...xs))},${c(Math.max(...ys))}`;
    });
  if (!boxes.length) return "";
  return `(While asking I marked this with a highlighter, drawn in the screenshot: ${boxes.join("; ")}, on the 0-1000 grid. "This" or "here" means the marked area.)`;
}

/**
 * End-of-utterance detection for hands-free mode: speech is a level above `threshold`; once the user
 * has spoken for at least `minSpeechMs`, `silenceMs` of quiet ends the question.
 */
export function createVad(o: { threshold?: number; silenceMs?: number; minSpeechMs?: number; maxMs?: number } = {}) {
  const threshold = o.threshold ?? 0.06;
  const silenceMs = o.silenceMs ?? 1100;
  const minSpeechMs = o.minSpeechMs ?? 300;
  const maxMs = o.maxMs ?? 30_000;
  let start = -1;
  let speechStart = -1;
  let lastVoice = -1;
  let noise = -1; // slow average of the quiet level
  return {
    /** Feed one level reading (0..1) at time `now` ms; true when the question is over. */
    push(level: number, now: number): boolean {
      if (start < 0) start = now;
      if (noise < 0) noise = level;
      const gate = Math.max(threshold, noise * 2.5);
      // Learn the room only from quiet moments, so speech does not raise its own bar.
      if (level < gate) noise = noise * 0.97 + level * 0.03;
      if (level >= gate) {
        if (speechStart < 0) speechStart = now;
        lastVoice = now;
      }
      if (speechStart >= 0 && lastVoice - speechStart >= minSpeechMs && now - lastVoice >= silenceMs) return true;
      return speechStart >= 0 && now - start >= maxMs;
    },
    get heardSpeech() { return speechStart >= 0; },
  };
}

/** Draws the user's strokes onto a JPEG data URL, so the model sees exactly what was marked. */
export async function burnStrokes(dataUrl: string, strokes: MarkedStroke[], color: string): Promise<string> {
  if (!strokes.length || typeof document === "undefined") return dataUrl;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext("2d");
  if (!g) return dataUrl;
  g.drawImage(img, 0, 0);
  g.strokeStyle = color;
  g.globalAlpha = 0.7;
  g.lineWidth = Math.max(4, canvas.width / 220);
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const s of strokes) {
    g.beginPath();
    s.points.forEach(([x, y], i) => {
      const px = (x / 1000) * canvas.width;
      const py = (y / 1000) * canvas.height;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    });
    g.stroke();
  }
  return canvas.toDataURL("image/jpeg", 0.75);
}
