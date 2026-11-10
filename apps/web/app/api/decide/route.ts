import { NextResponse } from "next/server";
import type { DecideRequest, DecideResponse, ServerDecisionProviderId } from "@filow/core";
import { requireEngine } from "@/lib/engineAuth";
import { decideOpenRouter, OPENROUTER_DECISION_MODEL } from "@/lib/decide/openrouter";
import { CLEF_CLOUDFLARE_MODEL, decideClefCloudflare, decideClefLocal } from "@/lib/decide/clef";
import { consentDenied, decisionRecipient } from "@/lib/buddy/outbound";
import { anonymizeRequest, piiMode, restore } from "@/lib/pii/guard";

/**
 * One call per engine tick. The provider comes from the request (chosen in
 * Settings), else DECISION_PROVIDER, else openrouter. In offline mode only
 * local providers are allowed. Cloud providers get an anonymised request
 * (PII guard) and placeholders are restored in the answer.
 */
const PROVIDERS: Record<ServerDecisionProviderId, { run: (b: DecideRequest, signal?: AbortSignal) => Promise<DecideResponse>; cloud: boolean }> = {
  openrouter: { run: decideOpenRouter, cloud: true },
  "clef-local": { run: decideClefLocal, cloud: false },
  "clef-cloudflare": { run: decideClefCloudflare, cloud: true },
};

function resolveProvider(requested?: string): ServerDecisionProviderId {
  const offline = process.env.FILOW_OFFLINE === "1";
  const fallback = (process.env.DECISION_PROVIDER as ServerDecisionProviderId) || "openrouter";
  const id = (requested && Object.hasOwn(PROVIDERS, requested) ? requested : fallback) as ServerDecisionProviderId;
  if (offline && id !== "clef-local") return "clef-local";
  return id;
}

export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as DecideRequest | null;
  // The on-device matcher runs in the page. A request naming it is a page bug: refuse it rather than
  // answer with the default provider, which may be a cloud one (no silent cloud fallback).
  if (body?.provider === "matcher") return NextResponse.json({ error: "the on-device matcher runs in the page, not on the server" }, { status: 400 });
  const provider = resolveProvider(body?.provider);
  if (!body?.bullets?.length) {
    return NextResponse.json<DecideResponse>({ decisions: [], latencyMs: 0, cost: 0, model: provider });
  }
  try {
    const { run, cloud } = PROVIDERS[provider];
    if (cloud) {
      // The spoken words leave this PC: only with the user's recorded yes for this exact recipient.
      const recipient = decisionRecipient(provider, { openrouter: OPENROUTER_DECISION_MODEL(), cloudflare: CLEF_CLOUDFLARE_MODEL() });
      const refused = recipient ? consentDenied(req, "transcript", recipient) : NextResponse.json({ error: "Not sent: Filow cannot tell who would read your words.", code: "consent_required" }, { status: 403 });
      if (refused) return refused;
    }
    // When the engine gives up on a slow call the page aborts it; the abort is passed on to the model.
    if (!cloud || piiMode() === "off") return NextResponse.json<DecideResponse>(await run(body, req.signal));
    const { req: safe, map, layers } = await anonymizeRequest(body);
    const out = await run(safe, req.signal);
    return NextResponse.json<DecideResponse>({
      ...out,
      unmentioned: out.unmentioned?.map((f) => restore(f, map)),
      model: map.size ? `${out.model} · pii ${layers.join("+")} (${map.size})` : out.model,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
