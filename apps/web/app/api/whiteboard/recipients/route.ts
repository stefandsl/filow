import { NextResponse } from "next/server";
import type { BuddyRecipients } from "@/lib/buddy/outbound";
import { configuredRecipients } from "@/lib/buddy/recipients";

export const dynamic = "force-dynamic";

/** The recipients as the whiteboard sees them: its online model may be its own (WHITEBOARD_CLOUD_MODEL). Sends nothing anywhere. */
export async function GET() {
  return NextResponse.json<BuddyRecipients>(configuredRecipients(true));
}