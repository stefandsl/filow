import { NextResponse } from "next/server";
import type { DecideRequest, DecideResponse, DecisionProviderId } from "@intelliprompter/core";
import { requireEngine } from "@/lib/engineAuth";
import { decideOpenRouter } from "@/lib/decide/openrouter";
import { decideClefCloudflare, decideClefLocal } from "@/lib/decide/clef";

/**
 * One call per engine tick. The provider comes from the request (chosen in
 * Settings), else DECISION_PROVIDER, else openrouter. In offline mode only
 * local providers are allowed.
 */
const PROVIDERS: Record<DecisionProviderId, (b: DecideRequest) => Promise<DecideResponse>> = {
  openrouter: decideOpenRouter,
  "clef-local": decideClefLocal,
  "clef-cloudflare": decideClefCloudflare,
};

function resolveProvider(requested?: string): DecisionProviderId {
  const offline = process.env.INTELLIPROMPTER_OFFLINE === "1";
  const fallback = (process.env.DECISION_PROVIDER as DecisionProviderId) || "openrouter";
  const id = (requested && requested in PROVIDERS ? requested : fallback) as DecisionProviderId;
  if (offline && id !== "clef-local") return "clef-local";
  return id;
}

export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const body = (await req.json()) as DecideRequest;
  const provider = resolveProvider(body.provider);
  if (!body?.bullets?.length) {
    return NextResponse.json<DecideResponse>({ decisions: [], latencyMs: 0, cost: 0, model: provider });
  }
  try {
    return NextResponse.json<DecideResponse>(await PROVIDERS[provider](body));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
