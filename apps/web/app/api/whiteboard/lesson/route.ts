import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { CONSENT_HEADER, consentDenied } from "@/lib/buddy/outbound";
import { BUDDY_CLOUD_MODEL, askBuddy, buddyCloudRecipient, resolveBuddyProvider, resolveLocalHelper, type LocalHelper } from "@/lib/buddy/providers";
import { answerLanguage, buddyLang } from "@/lib/buddy/lang";
import { StallError, generateCloud, generateLocal, maxStepsFor, texOk, type Ask, type LessonEvent } from "@/lib/whiteboard/generate";
import { LIMITS, cleanText, validateLesson } from "@/lib/whiteboard/lesson";

export const dynamic = "force-dynamic";

/**
 * Whiteboard lesson: a concept in, the lesson streamed back as JSON lines (start, outline, one
 * step at a time, done or error; docs/whiteboard/SPEC.md). No screenshot is taken or sent: only
 * the question text, and for a follow-up the lesson so far. Local by default; cloud only when asked
 * for and only with the user's yes for the recipient in use (x-filow-consent), as /api/buddy/ask.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  let body: { question?: unknown; provider?: unknown; setup?: unknown; language?: unknown; lesson?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const question = cleanText(body?.question, LIMITS.question);
  if (!question) return NextResponse.json({ error: "question is empty" }, { status: 400 });
  // The lesson a follow-up continues comes from the page: it is checked like model output.
  const lesson = body.lesson === undefined || body.lesson === null ? null : validateLesson(body.lesson, { maxSteps: 40, texOk, sketch: true });
  if (body.lesson !== undefined && body.lesson !== null && !lesson) return NextResponse.json({ error: "the lesson to continue is not valid" }, { status: 400 });

  const asked = resolveBuddyProvider(typeof body.provider === "string" ? body.provider : undefined);
  // The whiteboard draws with this PC's model or the cloud model. FreeLLMAPI is not one of its sources:
  // it is refused here, never quietly swapped for another one.
  if (asked === "freellm") return NextResponse.json({ error: "the whiteboard cannot use FreeLLMAPI: choose this PC or Cloud", code: "unsupported_provider" }, { status: 400 });
  const provider: "local" | "cloud" = asked;
  if (provider === "cloud") {
    const refused = consentDenied(req, "ask", buddyCloudRecipient());
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
      helper = await resolveLocalHelper(body.setup, "diagram");
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e), code: "no_local_helper" }, { status: 409 });
    }
  }
  // A text-only helper is the Lite setup: a shorter lesson, and the page draws it plainly.
  const lite = provider === "local" && !helper!.pictures;

  const abort = new AbortController();
  req.signal?.addEventListener("abort", () => abort.abort());
  const ask: Ask = async ({ system, user, format, maxTokens, timeoutMs, temperature }) => {
    const limit = AbortSignal.timeout(timeoutMs);
    let text = "";
    try {
      for await (const piece of askBuddy(provider, { question: user, images: [], screens: [], consent, language: lang }, AbortSignal.any([abort.signal, limit]), helper, { system, format, maxTokens, temperature })) text += piece;
    } catch (e) {
      if (limit.aborted && !abort.signal.aborted) throw new StallError();
      throw e;
    }
    if (limit.aborted && !abort.signal.aborted) throw new StallError();
    return text;
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: LessonEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        emit({ type: "start", provider, model: provider === "cloud" ? BUDDY_CLOUD_MODEL() : helper!.model, lang, lite, more: Boolean(lesson) });
        const request = { question, lang, maxSteps: maxStepsFor(lite), lesson, lite };
        if (provider === "cloud") await generateCloud(ask, request, emit);
        else await generateLocal(ask, request, emit);
      } catch (e) {
        if (!abort.signal.aborted) emit({ type: "error", code: e instanceof StallError ? "stalled" : "model", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Buddy-Provider": provider } });
}
