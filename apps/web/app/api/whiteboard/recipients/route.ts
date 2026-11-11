import { NextResponse } from "next/server";
import type { BuddyRecipients } from "@/lib/buddy/outbound";
import { configuredRecipients } from "@/lib/buddy/recipients";

export const dynamic = "force-dynamic";

/**
 * The recipients as the whiteboard sees them: its online model is its own (the one chosen on the
 * page, `?model=`, among the models it offers), so its notice names that model's maker. Sends nothing anywhere.
 */
export async function GET(req: Request) {
  return NextResponse.json<BuddyRecipients>(configuredRecipients(true, new URL(req.url).searchParams.get("model") ?? undefined));
}