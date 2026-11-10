// "Generate script from slides" (ARCHITECTURE.md §7.4): collect what Office.js exposes per
// slide, send it to POST /api/script/generate (the server runs the model; the pane never holds
// keys), and stream progress. Slides with little text or a picture also get a slide image when
// the host supports getImageAsBase64 (PowerPointApi 1.8).
/* global Office, PowerPoint */
import { slideNeedsImage, type GenerateProgress, type SlideInput } from "@filow/core";
import { pickTitle } from "./notes";
import { readAllSlideShapes, readNotesTexts } from "./shapes";

const IMAGE_WIDTH = 640;

/** Index, title, all text (shapes, tables, alt text), picture flag and notes, per slide. */
export async function readSlidesForGeneration(): Promise<SlideInput[]> {
  const slides: SlideInput[] = [];
  await PowerPoint.run(async (ctx) => {
    const perSlide = await readAllSlideShapes(ctx);
    perSlide.forEach((shapes, index) => {
      const titled: string[] = [];
      const texts: string[] = [];
      let hasPicture = false;
      for (const sh of shapes) {
        const name = sh.name.toLowerCase();
        if (/image|picture|media|graphic/i.test(sh.type) || /picture|image/.test(name)) hasPicture = true;
        if (sh.text) (name.includes("title") ? titled : texts).push(sh.text);
        else if (sh.alt) texts.push(sh.alt);
      }
      slides.push({ index, title: pickTitle([...titled, ...texts]), text: [...titled, ...texts].join("\n"), hasPicture });
    });
  });
  try {
    let notes: string[] = [];
    await PowerPoint.run(async (ctx) => {
      notes = await readNotesTexts(ctx);
    });
    notes.forEach((n, i) => {
      if (n && slides[i]) slides[i].notes = n;
    });
  } catch {
    /* no notes API on this host */
  }
  // Tables: cell text is not in textFrame; read them through the table API where available.
  try {
    await PowerPoint.run(async (ctx) => {
      const all = ctx.presentation.slides;
      all.load("items");
      await ctx.sync();
      const cols = all.items.map((slide, i) => {
        const shapes = slide.shapes;
        shapes.load("items/type");
        return { shapes, i };
      });
      await ctx.sync();
      const pending: Array<{ i: number; table: { values: string[][] } & { load: (p: string) => void } }> = [];
      for (const { shapes, i } of cols) {
        for (const sh of shapes.items) {
          if (String((sh as { type?: string }).type) !== "Table") continue;
          const t = (sh as unknown as { getTable: () => { values: string[][]; load: (p: string) => void } }).getTable();
          t.load("values");
          pending.push({ i, table: t });
        }
      }
      await ctx.sync();
      for (const { i, table } of pending) {
        const rows = (table.values ?? []).map((r) => r.filter(Boolean).join(" | ")).filter(Boolean);
        if (rows.length) slides[i].text += "\n" + rows.join("\n");
      }
    });
  } catch {
    /* hosts without the table API: text frames only */
  }
  return slides;
}

export function supportsSlideImages(): boolean {
  try {
    return Office.context.requirements.isSetSupported("PowerPointApi", "1.8");
  } catch {
    return false;
  }
}

/** Attach a slide image to the slides that need one (vision fallback). Best effort. */
export async function attachSlideImages(slides: SlideInput[]): Promise<number> {
  if (!supportsSlideImages()) return 0;
  const wanted = slides.filter(slideNeedsImage);
  if (!wanted.length) return 0;
  let attached = 0;
  try {
    await PowerPoint.run(async (ctx) => {
      const all = ctx.presentation.slides;
      all.load("items");
      await ctx.sync();
      const results = wanted.map((s) => {
        const slide = all.items[s.index] as unknown as { getImageAsBase64?: (o: { width: number }) => { value: string } };
        return { s, r: slide?.getImageAsBase64 ? slide.getImageAsBase64({ width: IMAGE_WIDTH }) : null };
      });
      await ctx.sync();
      for (const { s, r } of results) {
        if (r?.value) {
          s.imageBase64 = r.value;
          attached++;
        }
      }
    });
  } catch {
    /* no image API on this host */
  }
  return attached;
}

export type GenerateResult = { text: string; model: string; cost: number | null; provider: string };

/** POST /api/script/generate and read the NDJSON stream. */
export async function requestGeneration(
  origin: string,
  token: string,
  slides: SlideInput[],
  language: string | undefined,
  onProgress: (p: GenerateProgress) => void,
  /** The consent header when the script is written in the cloud (the server refuses without it). */
  extraHeaders: Record<string, string> = {},
): Promise<GenerateResult> {
  const res = await fetch(`${origin}/api/script/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...extraHeaders },
    body: JSON.stringify({ slides, language }),
  });
  if (!res.ok || !res.body) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? `generate failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: GenerateResult | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const j = JSON.parse(line) as { progress?: GenerateProgress; done?: boolean; error?: string } & Partial<GenerateResult>;
      if (j.error) throw new Error(j.error);
      if (j.progress) onProgress(j.progress);
      if (j.done) result = { text: j.text ?? "", model: j.model ?? "", cost: j.cost ?? null, provider: j.provider ?? "" };
    }
  }
  if (!result) throw new Error("the server closed the stream before finishing");
  return result;
}

/** View mode: an accepted controller can ask the relay for a short-lived engine token. */
export async function mintEngineToken(origin: string, sessionId: string, viewToken: string): Promise<string> {
  const res = await fetch(`${origin}/api/session/${sessionId}/engine-token`, { method: "POST", headers: { Authorization: `Bearer ${viewToken}` } });
  if (!res.ok) throw new Error(res.status === 401 ? "the presenter has not given this pane control" : `token failed (${res.status})`);
  return ((await res.json()) as { engineToken: string }).engineToken;
}
