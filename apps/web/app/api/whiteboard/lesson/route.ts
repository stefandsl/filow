import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { CONSENT_HEADER, consentDenied } from "@/lib/buddy/outbound";
import { WHITEBOARD_CLOUD_MODEL, askBuddy, whiteboardCloudRecipient, resolveBuddyProvider, resolveLocalHelper, type LocalHelper } from "@/lib/buddy/providers";
import { answerLanguage, buddyLang } from "@/lib/buddy/lang";
import { FreeLlmError, freellmRecipient, requireFreeLlm } from "@/lib/freellm";
import { BusyError, RETRY, StallError, TIMEOUTS, generateCloud, generateLocal, maxStepsFor, texOk, type Ask, type LessonEvent, type Spelling } from "@/lib/whiteboard/generate";
import { LIMITS, cleanText, validateLesson } from "@/lib/whiteboard/lesson";
import { serverAllowed } from "@/lib/modelRoles/helper";

export const dynamic = "force-dynamic";
const MAX_BODY = 64_000;

/**
 * Whiteboard lesson: a concept in, the lesson streamed back as JSON lines (start, outline, one
 * step at a time, done or error; docs/whiteboard/SPEC.md). No screenshot is taken or sent: only
 * the question text, and for a follow-up the lesson so far. Local by default; cloud only when asked
 * for and only with the user's yes for the recipient in use (x-filow-consent), as /api/buddy/ask.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  let body: { question?: unknown; provider?: unknown; setup?: unknown; language?: unknown; lesson?: unknown; audit?: unknown; spell?: unknown; model?: unknown };
  try {
    // a question and, for a follow-up, one lesson: anything much larger is not a whiteboard request
    const raw = await req.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ error: "request too large" }, { status: 413 });
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const question = cleanText(body?.question, LIMITS.question);
  if (!question) return NextResponse.json({ error: "question is empty" }, { status: 400 });
  // The lesson a follow-up continues comes from the page: it is checked like model output.
  const lesson = body.lesson === undefined || body.lesson === null ? null : validateLesson(body.lesson, { maxSteps: 40, texOk, sketch: true });
  if (body.lesson !== undefined && body.lesson !== null && !lesson) return NextResponse.json({ error: "the lesson to continue is not valid" }, { status: 400 });

  const provider = resolveBuddyProvider(typeof body.provider === "string" ? body.provider : undefined);
  if (provider === "freellm") {
    // The user's FreeLLMAPI router, as for OK Filow's answers: its own reasons to refuse first (offline,
    // no key, an address outside this network), then the user's yes for it. Never another source instead.
    try {
      requireFreeLlm();
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e), code: e instanceof FreeLlmError ? `freellm_${e.code}` : "freellm_failed" }, { status: 409 });
    }
    const refused = consentDenied(req, "ask", freellmRecipient());
    if (refused) return refused;
  }
  if (provider === "cloud") {
    const refused = consentDenied(req, "ask", whiteboardCloudRecipient(body.model));
    if (refused) return refused;
  }
  // Only the header counts: a consent field in the body is never trusted.
  const consent = req.headers.get(CONSENT_HEADER) ?? undefined;
  // A follow-up stays in the lesson's language (the page sends it); a new lesson uses the question's.
  const lang = (lesson ? buddyLang(body.language) : null) ?? answerLanguage(question, lesson ? undefined : body.language, req.headers.get("accept-language")) ?? "en";

  let helper: LocalHelper | undefined;
  if (provider === "local") {
    try {
      // "diagram": on Best quality a bigger picture model the user installed draws, as for OK Filow's drawings
      // the model the user chose for whiteboard lessons in Settings comes first
      helper = await resolveLocalHelper(body.setup, "diagram", undefined, "whiteboard");
      // the user's own server only with the yes for it (the whiteboard page asks); otherwise this PC draws
      if (!serverAllowed(helper, consent)) helper = await resolveLocalHelper(body.setup, "diagram", undefined, "whiteboard", false);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e), code: "no_local_helper" }, { status: 409 });
    }
  }
  // A text-only helper is the Lite setup: a shorter lesson, and the page draws it plainly.
  const lite = provider === "local" && !helper!.pictures;

  const abort = new AbortController();
  req.signal?.addEventListener("abort", () => abort.abort());
  // One lesson has an end, however many calls it takes: after that the model is cut off.
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; abort.abort(); }, TIMEOUTS.lessonMs);
  const ask: Ask = async ({ system, user, format, maxTokens, timeoutMs, temperature }) => {
    // An online provider that is busy (429) or failing (5xx) is asked again after a short wait, three
    // times at most, and then the user is told so. Never another provider instead.
    for (let attempt = 0; ; attempt++) {
      const limit = AbortSignal.timeout(timeoutMs);
      let text = "";
      try {
        for await (const piece of askBuddy(provider, { question: user, images: [], screens: [], consent, language: lang }, AbortSignal.any([abort.signal, limit]), helper, { system, format, maxTokens, temperature, ...(provider === "cloud" ? { model: WHITEBOARD_CLOUD_MODEL(body.model) } : {}) })) text += piece;
      } catch (e) {
        if (limit.aborted && !abort.signal.aborted) throw new StallError();
        const busy = provider !== "local" && !abort.signal.aborted && /\b(?:429|5\d\d)\b|rate.?limit|overloaded|temporarily/i.test(e instanceof Error ? e.message : String(e));
        if (!busy) throw e;
        if (attempt >= RETRY.waitsMs.length) throw new BusyError();
        await new Promise((resolve) => setTimeout(resolve, RETRY.waitsMs[attempt]));
        continue;
      }
      if (timedOut || (limit.aborted && !abort.signal.aborted)) throw new StallError();
      return text;
    }
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: LessonEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        emit({ type: "start", provider, model: provider === "cloud" ? WHITEBOARD_CLOUD_MODEL(body.model) : provider === "freellm" ? "FreeLLMAPI" : helper!.model, lang, lite, more: Boolean(lesson) });
        // audit: the proof bench asks for what the model first wrote and what each guard changed.
      // WHITEBOARD_GUARDS: guards that are off by default, switched on by name for a measured run ("must,links").
      const on = new Set((process.env.WHITEBOARD_GUARDS || "").split(",").map((g) => g.trim()));
      // WHITEBOARD_LOCAL_OFF: checks of the local path switched off by name for a measured run ("sentences,relations,repair").
      const off = new Set((process.env.WHITEBOARD_LOCAL_OFF || "").split(",").map((g) => g.trim()));
      const localChecks = { sentences: !off.has("sentences"), relations: !off.has("relations"), repair: !off.has("repair") };
      // An online account that hides names: the page says so once it has seen it (`spell`), and the names of
      // the question are then spelled out from the first call. WHITEBOARD_NAME_SPELLING picks how (spaced, hyphen, dots).
      const how = process.env.WHITEBOARD_NAME_SPELLING;
      const spelling: Spelling = how === "hyphen" || how === "dots" ? how : "spaced";
      const request = { templates: process.env.WHITEBOARD_TEMPLATES !== "off", spell: body.spell === true, spelling, localChecks, question, lang, maxSteps: maxStepsFor(lite), lesson, lite, audit: body.audit === true, guards: { legend: !on.has("nolegend"), examiner: on.has("examiner"), arrows: on.has("arrows"), sums: on.has("sums"), must: on.has("must"), links: on.has("links"), removeLoneBoxes: on.has("removeLoneBoxes") } };
        // an online model writes the whole lesson in one answer, whichever door it comes through
        if (provider !== "local") await generateCloud(ask, request, emit);
        else await generateLocal(ask, request, emit);
      } catch (e) {
        if (timedOut) emit({ type: "error", code: "stalled", message: "The lesson took too long." });
        else if (!abort.signal.aborted) emit({ type: "error", code: e instanceof StallError ? "stalled" : e instanceof BusyError ? "busy" : "model", message: e instanceof Error ? e.message : String(e) });
      } finally {
        clearTimeout(deadline);
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Buddy-Provider": provider } });
}
