import { NextResponse } from "next/server";
import type { VisionRequest, VisionResponse } from "@filow/core";
import { requireEngine } from "@/lib/engineAuth";
import { dataUrlBytes, describeFrame, MAX_IMAGE_BYTES } from "@/lib/vision/openrouter";
import { anonymizeRequest, piiMode, restore } from "@/lib/pii/guard";

/**
 * Screen Sense: one frame in, one ScreenSummary out (ARCHITECTURE.md §6).
 * Engine-only. In offline mode the feature is disabled: frames would have to
 * leave the machine, and no local vision model ships yet (§6.7).
 * Nothing about the image is logged. The text that travels with the frame
 * (section title, points, question) goes through the same PII guard as
 * /api/decide; the frame itself cannot be anonymised.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const at = Date.now();
  let body: VisionRequest;
  try {
    body = (await req.json()) as VisionRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const source = body?.source === "window" || body?.source === "region" ? body.source : "screen";
  if (process.env.FILOW_OFFLINE === "1") {
    return NextResponse.json<VisionResponse>({
      summary: { at, source, shows: "", pointsToMake: [], facts: [], unavailable: "disabled" },
      latencyMs: 0,
      cost: 0,
      model: "offline",
    });
  }
  if (typeof body?.image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(body.image)) {
    return NextResponse.json({ error: "image must be a JPEG, PNG or WebP data URL" }, { status: 400 });
  }
  if (dataUrlBytes(body.image) > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image too large" }, { status: 413 });
  }
  try {
    if (piiMode() === "off" || (!body.context && !body.question)) {
      return NextResponse.json<VisionResponse>(await describeFrame({ ...body, source }));
    }
    // Reuse the decide guard: the context rides as a DecideRequest, the map restores the answer.
    const { req: safe, map } = await anonymizeRequest({
      transcript: body.question ?? "",
      sectionTitle: body.context?.sectionTitle ?? "",
      bullets: (body.context?.points ?? []).map((text, i) => ({ id: String(i), text })),
    });
    const out = await describeFrame({
      ...body,
      source,
      question: safe.transcript || undefined,
      context: body.context ? { sectionTitle: safe.sectionTitle || undefined, points: safe.bullets.map((b) => b.text) } : undefined,
    });
    const r = (t: string) => restore(t, map);
    const summary = {
      ...out.summary,
      shows: r(out.summary.shows),
      pointsToMake: out.summary.pointsToMake.map(r),
      facts: out.summary.facts.map(r),
      ...(out.summary.mismatch ? { mismatch: r(out.summary.mismatch) } : {}),
    };
    return NextResponse.json<VisionResponse>({ ...out, summary });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
