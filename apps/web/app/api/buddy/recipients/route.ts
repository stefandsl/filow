import { NextResponse } from "next/server";
import type { BuddyRecipients } from "@/lib/buddy/outbound";
import { configuredRecipients } from "@/lib/buddy/recipients";

export const dynamic = "force-dynamic";

/** Who would receive what, from the providers and models actually configured (lib/buddy/recipients.ts). Sends nothing anywhere. */
export async function GET() {
  return NextResponse.json<BuddyRecipients>(configuredRecipients());
}