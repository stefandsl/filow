import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { resolveLocalHelper } from "@/lib/buddy/providers";
import { LIMITS, cleanText } from "@/lib/whiteboard/lesson";
import { EDIT_SCHEMA, editPrompt, quickEdit, readEditPlan, type SceneLine } from "@/lib/whiteboard/edits";
import { localJson } from "@/lib/whiteboard/local";
import { serverAllowed } from "@/lib/modelRoles/helper";
import { CONSENT_HEADER } from "@/lib/buddy/outbound";
import type { LocalHelper } from "@/lib/buddy/providers";

export const dynamic = "force-dynamic";
const MAX_BODY = 64_000;

/**
 * A follow-up on the board ("make the arrow red", "zoom into step 2", "add an example"): the model
 * on this PC reads the board's elements (ids, types, words; no picture) and says which ids to change
 * and how, or that the request needs new explaining (the page then continues the lesson as before).
 * Simple camera requests need no model at all. The model is the one the lesson uses: on this PC, or on
 * the user's own server only when the request carries the yes for it.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  let body: { request?: unknown; scene?: unknown; steps?: unknown; setup?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ error: "request too large" }, { status: 413 });
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const request = cleanText(body.request, LIMITS.question);
  if (!request) return NextResponse.json({ error: "request is empty" }, { status: 400 });
  const scene: SceneLine[] = (Array.isArray(body.scene) ? body.scene : []).slice(0, 80).flatMap((s) => {
    const q = s as Record<string, unknown>;
    const id = typeof q.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(q.id) ? q.id : "";
    if (!id) return [];
    return [{ id, type: cleanText(q.type, 16), step: typeof q.step === "number" && Number.isFinite(q.step) ? Math.max(-1, Math.min(40, Math.round(q.step))) : 0, ...(q.text ? { text: cleanText(q.text, 60) } : {}), ...(typeof q.from === "string" ? { from: q.from.slice(0, 64) } : {}), ...(typeof q.to === "string" ? { to: q.to.slice(0, 64) } : {}) }];
  });
  const steps = (Array.isArray(body.steps) ? body.steps : []).slice(0, 40).map((s) => cleanText(s, LIMITS.say)).filter(Boolean);
  const quick = quickEdit(request);
  if (quick) return NextResponse.json(quick);
  let helper: LocalHelper;
  try {
    // the model chosen for whiteboard lessons in Settings, as for the lesson itself; the user's own
    // server only with the yes for it (the header the page sends), otherwise this PC
    helper = await resolveLocalHelper(body.setup, request, false, "whiteboard");
    if (!serverAllowed(helper, req.headers.get(CONSENT_HEADER) ?? undefined)) helper = await resolveLocalHelper(body.setup, request, false, "whiteboard", false);
  } catch {
    // no model on this PC: the page treats the follow-up as a question, through its usual route
    return NextResponse.json({ kind: "explain", said: "", changes: [] });
  }
  try {
    const { system, user } = editPrompt(request, scene, steps);
    const raw = await localJson(helper.model, system, user, EDIT_SCHEMA, { timeoutMs: 60_000, maxTokens: 500, at: helper.at });
    const plan = readEditPlan(raw, new Set(scene.map((s) => s.id)), steps.length);
    return NextResponse.json(plan ?? { kind: "explain", said: "", changes: [] });
  } catch {
    return NextResponse.json({ kind: "explain", said: "", changes: [] });
  }
}
