import { NextResponse } from "next/server";
import type { BuddyRecipients } from "@/lib/buddy/outbound";
import { configuredRecipients } from "@/lib/buddy/recipients";
import { serverRecipients } from "@/lib/modelRoles/recipients";

export const dynamic = "force-dynamic";

/**
 * The recipients as the whiteboard sees them: its online model is its own (the one chosen on the
 * page, `?model=`, among the models it offers), so its notice names that model's maker; on "Local",
 * the user's own server when he chose one for whiteboard lessons. Sends nothing anywhere.
 */
export async function GET(req: Request) {
  const base = configuredRecipients(true, new URL(req.url).searchParams.get("model") ?? undefined);
  const server = (await serverRecipients()).whiteboard;
  return NextResponse.json<BuddyRecipients>({ ...base, ...(server ? { server } : {}) });
}
