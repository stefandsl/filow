import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { dataUrlBytes, MAX_IMAGE_BYTES } from "@/lib/vision/openrouter";
import { askBuddy, resolveBuddyProvider, type BuddyAskRequest } from "@/lib/buddy/providers";

export const dynamic = "force-dynamic";

/**
 * OK Filow: question + one screenshot per display in, the answer streamed back as plain text
 * (with [POINT] tags, parsed by the client). Images are forwarded once and never logged or stored.
 * The provider used is in the X-Buddy-Provider header; errors after the stream started are sent
 * as a final "\n[ERROR] message" line.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  let body: BuddyAskRequest;
  try {
    body = (await req.json()) as BuddyAskRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 2000) : "";
  if (!question) return NextResponse.json({ error: "question is empty" }, { status: 400 });
  const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
  const screens = Array.isArray(body.screens) ? body.screens.slice(0, images.length) : [];
  if (!images.length || screens.length !== images.length) return NextResponse.json({ error: "one screenshot per screen is required" }, { status: 400 });
  for (const image of images) {
    if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) return NextResponse.json({ error: "images must be JPEG, PNG or WebP data URLs" }, { status: 400 });
    if (dataUrlBytes(image) > MAX_IMAGE_BYTES) return NextResponse.json({ error: "image too large" }, { status: 413 });
  }
  const provider = resolveBuddyProvider(body.provider);
  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal?.addEventListener("abort", () => abort.abort());
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const piece of askBuddy(provider, { ...body, question, images, screens }, abort.signal)) controller.enqueue(encoder.encode(piece));
      } catch (e) {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(`\n[ERROR] ${e instanceof Error ? e.message : String(e)}`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Buddy-Provider": provider },
  });
}
