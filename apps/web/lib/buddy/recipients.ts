import { CLEF_CLOUDFLARE_MODEL } from "@/lib/decide/clef";
import { OPENROUTER_DECISION_MODEL } from "@/lib/decide/openrouter";
import { askRecipient, freellmRecipient, photoRecipient, voiceRecipient, type BuddyRecipients } from "@/lib/buddy/outbound";
import { resolveGenerateProvider, scriptRecipient } from "@/lib/generate/providers";
import { resolveDecisionProvider } from "@/lib/decide/resolve";
import { VISION_MODEL } from "@/lib/vision/openrouter";
import { buddyCloudRecipient, whiteboardCloudRecipient } from "@/lib/buddy/providers";

/**
 * Who would receive what, from the providers and models actually configured. The notices and the
 * "going outside" signal read their names from here, never from fixed text. Sends nothing anywhere.
 * `whiteboard`: the whiteboard may use an online model of its own (WHITEBOARD_CLOUD_MODEL), and its
 * notice then names that model's maker.
 */
export function configuredRecipients(whiteboard = false, whiteboardModel?: unknown): BuddyRecipients {
  return {
    offline: process.env.FILOW_OFFLINE === "1",
    ask: whiteboard ? whiteboardCloudRecipient(whiteboardModel) : buddyCloudRecipient(),
    freellm: freellmRecipient(),
    voice: voiceRecipient(),
    photo: photoRecipient(),
    screen: askRecipient(VISION_MODEL()),
    script: scriptRecipient(),
    decision: { openrouter: OPENROUTER_DECISION_MODEL(), cloudflare: CLEF_CLOUDFLARE_MODEL() },
    defaults: { decide: resolveDecisionProvider(), generate: resolveGenerateProvider() },
  };
}