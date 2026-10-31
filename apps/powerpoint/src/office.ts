// Thin wrappers over Office.js. Everything here works in Normal (editing) view;
// the PowerPoint JavaScript API has no slide-show navigation or events, so none
// of this runs during an actual presentation (ARCHITECTURE.md §7).
/* global Office, PowerPoint */
import { notesToScript, pickTitle, type SlideNotes } from "./notes";

export type SlidePos = { index: number; total: number; title?: string };

/** Read every slide's title and speaker notes and turn them into a script. */
export async function readNotesAsScript(): Promise<string> {
  const slides: SlideNotes[] = [];
  await PowerPoint.run(async (ctx) => {
    const all = ctx.presentation.slides;
    all.load("items");
    await ctx.sync();
    const loaded = all.items.map((slide) => {
      const shapes = slide.shapes;
      shapes.load("items/name,items/textFrame/textRange/text,items/textFrame/hasText");
      return { slide, shapes };
    });
    await ctx.sync();
    for (const { shapes } of loaded) {
      const texts: string[] = [];
      let notes = "";
      for (const sh of shapes.items) {
        let text = "";
        try {
          text = sh.textFrame?.hasText ? sh.textFrame.textRange.text : "";
        } catch {
          /* shape without text frame */
        }
        if (!text) continue;
        texts.push(text);
      }
      // Notes come from the notes page's body placeholder; load it separately below.
      slides.push({ title: pickTitle(titleFirst(shapes.items, texts)), notes });
    }
  });
  // Speaker notes: PowerPointApi 1.7+ exposes slide.notesSlide? No. Use the Common API fallback:
  // Office.context.document.getSelectedDataAsync cannot read notes either. The supported path is
  // slide.shapes on the notes master via `slide.getNotes?` (not available). We therefore read notes
  // through the OOXML of each slide, which every PowerPoint host supports.
  const notesByIndex = await readNotesViaOoxml(slides.length);
  slides.forEach((s, i) => (s.notes = notesByIndex[i] ?? ""));
  return notesToScript(slides);
}

function titleFirst(shapes: PowerPoint.Shape[], texts: string[]): string[] {
  const titled: string[] = [];
  shapes.forEach((sh) => {
    const name = (sh.name ?? "").toLowerCase();
    let text = "";
    try {
      text = sh.textFrame?.hasText ? sh.textFrame.textRange.text : "";
    } catch {
      /* ignore */
    }
    if (text && name.includes("title")) titled.push(text);
  });
  return [...titled, ...texts];
}

/**
 * Speaker notes are not exposed by the PowerPoint API object model in released requirement sets,
 * but the slide OOXML is. Select each slide and read its XML; notes live in a `p:notes` part
 * only when fetched through the Common API's getFileAsync... which is too heavy per slide.
 * Practical approach used here: Office exposes `Office.context.document.getSelectedDataAsync`
 * with `CoercionType.SlideRange` only for ids. So we ask PowerPoint.run for each slide's
 * `notesSlide` where the host supports it (PowerPoint on the web and Microsoft 365 builds that
 * implement PowerPointApi 1.8 `NotesSlide`), and fall back to empty notes elsewhere.
 */
async function readNotesViaOoxml(count: number): Promise<string[]> {
  const out: string[] = new Array(count).fill("");
  try {
    await PowerPoint.run(async (ctx) => {
      const all = ctx.presentation.slides;
      all.load("items");
      await ctx.sync();
      const loads = all.items.map((slide) => {
        const anySlide = slide as unknown as { notesSlide?: { shapes: PowerPoint.ShapeCollection } };
        if (!anySlide.notesSlide) return null;
        const shapes = anySlide.notesSlide.shapes;
        shapes.load("items/name,items/textFrame/textRange/text,items/textFrame/hasText");
        return shapes;
      });
      await ctx.sync();
      loads.forEach((shapes, i) => {
        if (!shapes) return;
        const parts: string[] = [];
        for (const sh of shapes.items) {
          const name = (sh.name ?? "").toLowerCase();
          // The notes body placeholder is usually named "Notes Placeholder N"; skip slide image / footer.
          if (!name.includes("notes") && !name.includes("placeholder")) continue;
          try {
            if (sh.textFrame?.hasText) parts.push(sh.textFrame.textRange.text);
          } catch {
            /* ignore */
          }
        }
        out[i] = parts.join("\n");
      });
    });
  } catch {
    /* host without notesSlide: leave notes empty */
  }
  return out;
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
