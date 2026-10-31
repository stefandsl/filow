// Thin wrappers over Office.js. Everything here works in Normal (editing) view;
// the PowerPoint JavaScript API has no slide-show navigation or events, so none
// of this runs during an actual presentation (ARCHITECTURE.md §7).
/* global Office, PowerPoint */
import { notesToScript, pickTitle, type SlideNotes } from "./notes";
import { readAllSlideShapes, readNotesTexts } from "./shapes";

export type SlidePos = { index: number; total: number; title?: string };

/** Read every slide's title and speaker notes and turn them into a script. */
export async function readNotesAsScript(): Promise<string> {
  const slides: SlideNotes[] = [];
  await PowerPoint.run(async (ctx) => {
    const perSlide = await readAllSlideShapes(ctx);
    for (const shapes of perSlide) {
      const titled = shapes.filter((x) => x.text && x.name.toLowerCase().includes("title")).map((x) => x.text);
      const texts = shapes.filter((x) => x.text && !x.name.toLowerCase().includes("title")).map((x) => x.text);
      slides.push({ title: pickTitle([...titled, ...texts]), notes: "" });
    }
  });
  let notes: string[] = [];
  try {
    await PowerPoint.run(async (ctx) => {
      notes = await readNotesTexts(ctx);
    });
  } catch {
    /* host without notesSlide: leave notes empty */
  }
  slides.forEach((s, i) => (s.notes = notes[i] ?? ""));
  return notesToScript(slides);
}

/** Whether this host can read speaker notes (PowerPointApi 1.8 NotesSlide). */
export function supportsNotes(): boolean {
  try {
    return Office.context.requirements.isSetSupported("PowerPointApi", "1.8");
  } catch {
    return false;
  }
}

/** Current selected slide in Normal view. */
export async function getSelectedSlide(): Promise<SlidePos | null> {
  let pos: SlidePos | null = null;
  await PowerPoint.run(async (ctx) => {
    const selected = ctx.presentation.getSelectedSlides();
    const all = ctx.presentation.slides;
    selected.load("items/id");
    all.load("items/id");
    await ctx.sync();
    if (!selected.items.length) return;
    const id = selected.items[0].id;
    const index = all.items.findIndex((s) => s.id === id);
    if (index < 0) return;
    pos = { index, total: all.items.length };
  });
  return pos;
}

/** Subscribe to selection changes (Normal view only). Returns an unsubscribe. */
export function onSelectionChange(cb: (pos: SlidePos) => void): () => void {
  let last = -1;
  const handler = async () => {
    const pos = await getSelectedSlide().catch(() => null);
    if (pos && pos.index !== last) {
      last = pos.index;
      cb(pos);
    }
  };
  Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, handler);
  void handler();
  return () => {
    Office.context.document.removeHandlerAsync(Office.EventType.DocumentSelectionChanged, { handler });
  };
}

/** Select slide n (0-based) in Normal view. */
export async function selectSlide(n: number): Promise<void> {
  await PowerPoint.run(async (ctx) => {
    const all = ctx.presentation.slides;
    all.load("items/id");
    await ctx.sync();
    const slide = all.items[n];
    if (!slide) return;
    ctx.presentation.setSelectedSlides([slide.id]);
    await ctx.sync();
  });
}

export type HostInfo = { platform: string; canUseMic: boolean; webSpeech: boolean };

/** Engine mode is possible only where the pane runtime exposes getUserMedia (WebView2, web). */
export function hostInfo(): HostInfo {
  let platform = "unknown";
  try {
    platform = String(Office.context.diagnostics?.platform ?? "unknown");
  } catch {
    /* not in Office */
  }
  const canUseMic = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && (platform === "PC" || platform === "OfficeOnline");
  const webSpeech = platform === "OfficeOnline" && Boolean((globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
  return { platform, canUseMic, webSpeech };
}
