import { NextResponse } from "next/server";
import { CLEF_CLOUDFLARE_MODEL } from "@/lib/decide/clef";
import { OPENROUTER_DECISION_MODEL } from "@/lib/decide/openrouter";
import { photoRecipient, voiceRecipient, type BuddyRecipients } from "@/lib/buddy/outbound";
import { buddyCloudRecipient } from "@/lib/buddy/providers";

export const dynamic = "force-dynamic";

/**
 * Who would receive what, from the providers and models actually configured. The notices and the
 * "going outside" signal read their names from here, never from fixed text. Sends nothing anywhere.
 */
export async function GET() {
  return NextResponse.json<BuddyRecipients>({
    offline: process.env.FILOW_OFFLINE === "1",
    ask: buddyCloudRecipient(),
    voice: voiceRecipient(),
    photo: photoRecipient(),
    decision: { openrouter: OPENROUTER_DECISION_MODEL(), cloudflare: CLEF_CLOUDFLARE_MODEL() },
  });
}
