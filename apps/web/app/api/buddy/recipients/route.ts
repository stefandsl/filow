import { NextResponse } from "next/server";
import type { BuddyRecipients } from "@/lib/buddy/outbound";
import { configuredRecipients } from "@/lib/buddy/recipients";
import { serverRecipients } from "@/lib/modelRoles/recipients";

export const dynamic = "force-dynamic";

/**
 * Who would receive what, from the providers and models actually configured (lib/buddy/recipients.ts),
 * and the user's own server when a "local" question or the take's decisions go there. Sends nothing anywhere.
 */
export async function GET() {
  const base = configuredRecipients();
  const servers = await serverRecipients();
  // named only when there is one: without a server the answer is what it always was
  return NextResponse.json<BuddyRecipients>({
    ...base,
    ...(servers.okfilow ? { server: servers.okfilow } : {}),
    decision: { ...base.decision, ...(servers.decision ? { local: servers.decision } : {}) },
  });
}
