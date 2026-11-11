import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { serverSetup } from "@/lib/buddy/providers";

export const dynamic = "force-dynamic";

/**
 * What the setup for this computer picked for OK Filow's answers on this PC: "picture" (it reads the
 * screen), "text" (the user's words only: pictures are slow here) or "none". The panel's "Look at my
 * screen" switch shows this until the user chooses. Nothing is sent anywhere.
 */
export async function GET(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const setup = await serverSetup(new URL(req.url).searchParams.get("setup") ?? "auto");
  return NextResponse.json({ local: setup.choices.screenHelper.mode }, { headers: { "Cache-Control": "no-store" } });
}
