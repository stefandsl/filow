import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { CONSENT_HEADER, consentDenied, MEMORY_CONSENT_HEADER, memoryAllowed, serverRecipient } from "@/lib/buddy/outbound";
import { askBuddy, buddyCloudRecipient, resolveBuddyProvider, resolveLocalHelper, type LocalHelper } from "@/lib/buddy/providers";
import { LEARN_SYSTEM, parseLearned } from "@/lib/buddy/memory";
import { FreeLlmError, freellmRecipient, requireFreeLlm } from "@/lib/freellm";

export const dynamic = "force-dynamic";

/**
 * "Remember things about me" (docs/okfilow/MEMORY.md): after an answer, the panel asks which short
 * facts or preferences the user stated in the question. Only the question goes to the model, through
 * the same route as the answer: never the screen, the answer or the conversation. On this PC it stays
 * on this PC; online, or to the user's own server, it needs the yes for the saved preferences
 * (MEMORY_CONSENT_HEADER) besides the yes for the question (CONSENT_HEADER). Nothing is stored here:
 * the desktop app decides what may be kept (apps/desktop/okfilow-memory.js).
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  let body: { question?: unknown; provider?: unknown; setup?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 2000) : "";
  if (!question) return NextResponse.json({ facts: [] });
  const provider = resolveBuddyProvider(typeof body.provider === "string" ? body.provider : undefined);
  if (provider === "cloud" || provider === "freellm") {
    if (provider === "freellm") {
      try {
        requireFreeLlm();
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e), code: e instanceof FreeLlmError ? `freellm_${e.code}` : "freellm_failed" }, { status: 409 });
      }
    }
    const to = provider === "cloud" ? buddyCloudRecipient() : freellmRecipient();
    const refused = consentDenied(req, "memory", to, MEMORY_CONSENT_HEADER) ?? consentDenied(req, "ask", to);
    if (refused) return refused;
  }
  let helper: LocalHelper | undefined;
  if (provider === "local") {
    try {
      helper = await resolveLocalHelper(body.setup, "", false);
      // The user's own server only with the yes for the saved preferences there; otherwise this PC.
      const servers = [helper.at?.server, helper.pointerAt?.server].filter((s): s is { id: string; name: string } => Boolean(s));
      if (!servers.every((s) => memoryAllowed(req, serverRecipient(s)))) helper = await resolveLocalHelper(body.setup, "", false, "okfilowAnswers", false);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
    }
    helper = { ...helper, pointer: undefined, pointerAt: undefined };
  }
  let reply = "";
  const signal = AbortSignal.any([req.signal ?? new AbortController().signal, AbortSignal.timeout(60_000)]);
  try {
    const shape = { system: LEARN_SYSTEM, maxTokens: 120, temperature: 0, pictures: false };
    const ask = { question, images: [], screens: [], history: [], sees: false, consent: req.headers.get(CONSENT_HEADER) ?? undefined };
    for await (const piece of askBuddy(provider, ask, signal, helper, shape)) reply += piece;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  return NextResponse.json({ facts: parseLearned(reply) }, { headers: { "Cache-Control": "no-store", "X-Buddy-Provider": provider } });
}
