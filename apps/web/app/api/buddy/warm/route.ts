import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { warmLocalModel } from "@/lib/buddy/providers";

export const dynamic = "force-dynamic";

/**
 * OK Filow: loads the local vision model into memory ahead of the first question, so it answers in
 * seconds instead of waiting for a cold load. Sends no image and no text; local only. Not on a small
 * graphics card the local decision model needs whole (warmLocalModel): a take there keeps its model.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  // the setup preference picks the screen helper to load (absent = "auto")
  const body = (await req.json().catch(() => ({}))) as { setup?: unknown };
  return NextResponse.json(await warmLocalModel(body?.setup));
}
