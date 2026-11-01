// Pure conversion: slide titles + speaker notes → Filow script text.
// One slide = one section. Note lines starting with - * • become points; other
// note lines are ignored (they are the presenter's prose, not checklist items).
import { SLIDES_MARKER } from "@filow/core";

export type SlideNotes = { title?: string; notes: string };

export function notesToScript(slides: SlideNotes[]): string {
  const blocks = slides.map((s, i) => {
    const title = (s.title ?? "").trim() || `Slide ${i + 1}`;
    const points = s.notes
      .split(/\r?\n/)
      .map((l) => l.trim())
      .map((l) => l.match(/^[-*•]\s*(.+)$/)?.[1]?.trim())
      .filter((p): p is string => Boolean(p));
    return [`# ${title}`, ...points.map((p) => `- ${p}`)].join("\n");
  });
  return [SLIDES_MARKER, ...blocks].join("\n\n") + "\n";
}

/** Title heuristic: first non-empty line of the slide's title placeholder, else the first text line. */
export function pickTitle(texts: string[]): string | undefined {
  for (const t of texts) {
    const line = t.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (line) return line.slice(0, 120);
  }
  return undefined;
}
