import { NextResponse } from "next/server";
import type { VisionRequest, VisionResponse } from "@intelliprompter/core";
import { requireEngine } from "@/lib/engineAuth";
import { dataUrlBytes, describeFrame, MAX_IMAGE_BYTES } from "@/lib/vision/openrouter";

/**
 * Screen Sense: one frame in, one ScreenSummary out (ARCHITECTURE.md §6).
 * Engine-only. In offline mode the feature is disabled: frames would have to
 * leave the machine, and no local vision model ships yet (§6.7).
 * Nothing about the image is logged.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const at = Date.now();
  if (process.env.INTELLIPROMPTER_OFFLINE === "1") {
    return NextResponse.json<VisionResponse>({
      summary: { at, source: "screen", shows: "", pointsToMake: [], facts: [], unavailable: "disabled" },
      latencyMs: 0,
      cost: 0,
      model: "offline",
    });
  }
  let body: VisionRequest;
  try {
    body = (await req.json()) as VisionRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body?.image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(body.image)) {
    return NextResponse.json({ error: "image must be a JPEG, PNG or WebP data URL" }, { status: 400 });
  }
  if (dataUrlBytes(body.image) > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image too large" }, { status: 413 });
  }
  const source = body.source === "window" || body.source === "region" ? body.source : "screen";
  try {
    return NextResponse.json<VisionResponse>(await describeFrame({ ...body, source }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
