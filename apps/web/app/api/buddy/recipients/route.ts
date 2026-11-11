import { NextResponse } from "next/server";
import { CLEF_CLOUDFLARE_MODEL } from "@/lib/decide/clef";
import { OPENROUTER_DECISION_MODEL } from "@/lib/decide/openrouter";
import { askRecipient, freellmRecipient, photoRecipient, voiceRecipient, type BuddyRecipients } from "@/lib/buddy/outbound";
import { resolveGenerateProvider, scriptRecipient } from "@/lib/generate/providers";
import { resolveDecisionProvider } from "@/lib/decide/resolve";
import { VISION_MODEL } from "@/lib/vision/openrouter";
import { buddyCloudRecipient, whiteboardCloudRecipient } from "@/lib/buddy/providers";

export const dynamic = "force-dynamic";

/**
 * Who would receive what, from the providers and models actually configured. The notices and the
 * "going outside" signal read their names from here, never from fixed text. Sends nothing anywhere.
 */
export async function GET(req: Request = new Request("http://filow.invalid/api/buddy/recipients")) {
  // the whiteboard may use an online model of its own (WHITEBOARD_CLOUD_MODEL): its notice names that one
  const whiteboard = new URL(req.url).searchParams.get("for") === "whiteboard";
  return NextResponse.json<BuddyRecipients>({
    offline: process.env.FILOW_OFFLINE === "1",
    ask: whiteboard ? whiteboardCloudRecipient() : buddyCloudRecipient(),
    freellm: freellmRecipient(),
    voice: voiceRecipient(),
    photo: photoRecipient(),
    screen: askRecipient(VISION_MODEL()),
    script: scriptRecipient(),
    decision: { openrouter: OPENROUTER_DECISION_MODEL(), cloudflare: CLEF_CLOUDFLARE_MODEL() },
    defaults: { decide: resolveDecisionProvider(), generate: resolveGenerateProvider() },
  });
}
