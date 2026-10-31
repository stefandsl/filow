import { NextResponse } from "next/server";
import { generateScript, parseScript, slideNeedsImage, type GenerateRequest, type SlideInput } from "@intelliprompter/core";
import { requireEngine } from "@/lib/engineAuth";
import { anonymizeRequest, piiMode, restore } from "@/lib/pii/guard";
import { generateSlideOllama, generateSlideOpenRouter, resolveGenerateProvider } from "@/lib/generate/providers";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_SLIDES = 200;
const MAX_IMAGE_CHARS = 2_000_000; // ~1.5 MB per slide image

/**
 * Slide deck → script.md (ARCHITECTURE.md §7.4). Engine-only, like every spend endpoint.
 * Streams NDJSON: one {progress} line per slide, then {done, text, model, cost, perSlide}.
 * Cloud calls get slide text through the PII guard; images are sent only for slides that
 * need them (little text or a picture) and only when the caller attached one.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body?.slides) || !body.slides.length) return NextResponse.json({ error: "slides[] required" }, { status: 400 });
  if (body.slides.length > MAX_SLIDES) return NextResponse.json({ error: `at most ${MAX_SLIDES} slides` }, { status: 413 });
  const slides: SlideInput[] = body.slides.map((s, i) => ({
    index: typeof s.index === "number" ? s.index : i,
    title: typeof s.title === "string" ? s.title.slice(0, 300) : undefined,
    text: typeof s.text === "string" ? s.text.slice(0, 8000) : "",
    notes: typeof s.notes === "string" ? s.notes.slice(0, 8000) : undefined,
    hasPicture: Boolean(s.hasPicture),
    imageBase64: typeof s.imageBase64 === "string" && s.imageBase64.length <= MAX_IMAGE_CHARS ? s.imageBase64.replace(/^data:image\/\w+;base64,/, "") : undefined,
  }));
  // Vision only where it helps: drop images the caller attached to text-rich slides.
  for (const s of slides) if (s.imageBase64 && !slideNeedsImage(s)) s.imageBase64 = undefined;

  const provider = resolveGenerateProvider(body.provider);
  const cloud = provider === "openrouter";
  const run = cloud ? generateSlideOpenRouter : generateSlideOllama;
  const guard = cloud && piiMode() !== "off";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const line = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try {
        const out = await generateScript(
          { ...body, slides },
          async (slide, opts) => {
            if (!guard) return run(slide, opts);
            // Reuse the decide guard: title/text/notes travel as a DecideRequest; placeholders are restored in the answer.
            const { req: safe, map } = await anonymizeRequest({
              transcript: slide.text,
              sectionTitle: slide.title ?? "",
              bullets: slide.notes ? [{ id: "n", text: slide.notes }] : [],
            });
            const r = await run({ ...slide, text: safe.transcript, title: safe.sectionTitle || undefined, notes: safe.bullets[0]?.text }, opts);
            const g = r.generated;
            return { ...r, generated: { title: restore(g.title, map), points: g.points.map((p) => restore(p, map)), transition: g.transition ? restore(g.transition, map) : undefined } };
          },
          (p) => line({ progress: p }),
        );
        line({ done: true, text: out.text, script: parseScript(out.text), model: out.model, cost: out.cost, perSlide: out.perSlide, provider });
      } catch (err) {
        line({ error: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
