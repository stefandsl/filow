import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { dataUrlBytes, MAX_IMAGE_BYTES } from "@/lib/vision/openrouter";
import { CONSENT_HEADER, consentDenied } from "@/lib/buddy/outbound";
import { askBuddy, buddyCloudRecipient, resolveBuddyProvider, resolveLocalHelper, type BuddyAskRequest, type LocalHelper } from "@/lib/buddy/providers";
import { answerLanguage } from "@/lib/buddy/lang";
import { drawnAnswer } from "@/lib/buddy/draw";
import { wantsDrawing } from "@/lib/buddy/visuals";
import { photoAnswer, photoOnly } from "@/lib/buddy/photo";
import { isPointOnly, pointQuestion, POINTER_MAX_TOKENS, POINTER_MS, withPointer } from "@/lib/buddy/pointer";
import { buddySystemPrompt, resumeQuestion } from "@/lib/buddy/prompt";
import { okfText } from "@/lib/buddy/text";
import { placeholderLeaks } from "@/lib/pii/guard";
import { FreeLlmError, freellmRecipient, requireFreeLlm } from "@/lib/freellm";

export const dynamic = "force-dynamic";

/**
 * OK Filow: question + one screenshot per display in, the answer streamed back as plain text
 * (with [POINT] tags, parsed by the client). Images are forwarded once and never logged or stored.
 * The provider used is in the X-Buddy-Provider header and the answer's language (`lang`: en, it,
 * ru, ro or ja) in X-Buddy-Lang; errors after the stream started are sent
 * as a final "\n[ERROR] message" line.
 * Cloud needs the user's yes for the recipient in use (x-filow-consent header): without it the
 * answer is 403 and nothing is forwarded.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  let body: BuddyAskRequest;
  try {
    body = (await req.json()) as BuddyAskRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 2000) : "";
  if (!question) return NextResponse.json({ error: "question is empty" }, { status: 400 });
  // A plain request for a photo of a thing is answered with a card (lib/buddy/photo.ts): no model, no
  // screenshot and no provider are needed, so nothing of the question goes anywhere and the answer is
  // immediate on every computer. The picture itself is fetched by the page from Wikipedia, only after the
  // user's yes for Wikipedia (the subject's name is all that is sent); in Offline mode the answer says why none comes.
  const photo = photoOnly(question, { drawing: wantsDrawing(question) !== null, resume: body.resume === true });
  if (photo) {
    const photoLang = answerLanguage(question, body.language, req.headers.get("accept-language")) ?? "en";
    const said = process.env.FILOW_OFFLINE === "1" ? okfText(photoLang)("photoOffline") : photoAnswer(photo, okfText(photoLang)("photoHere"));
    return new Response(said, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Buddy-Provider": "local", "X-Buddy-Lang": photoLang, "X-Buddy-Sees": "text" },
    });
  }
  // "Look at my screen" in the panel: false = the user's words only, and no screenshot is read or
  // forwarded even if one was sent; true or absent = one screenshot per screen, as before.
  const sees = typeof body.sees === "boolean" ? body.sees : undefined;
  const images = sees === false ? [] : Array.isArray(body.images) ? body.images.slice(0, 4) : [];
  const screens = Array.isArray(body.screens) ? body.screens.slice(0, sees === false ? 4 : images.length) : [];
  if (sees !== false && (!images.length || screens.length !== images.length)) return NextResponse.json({ error: "one screenshot per screen is required" }, { status: 400 });
  for (const image of images) {
    if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) return NextResponse.json({ error: "images must be JPEG, PNG or WebP data URLs" }, { status: 400 });
    if (dataUrlBytes(image) > MAX_IMAGE_BYTES) return NextResponse.json({ error: "image too large" }, { status: 413 });
  }
  const provider = resolveBuddyProvider(body.provider);
  if (provider === "cloud") {
    const refused = consentDenied(req, "ask", buddyCloudRecipient());
    if (refused) return refused;
  }
  if (provider === "freellm") {
    // Offline mode, no key or an address outside the user's network: said at once, nothing is sent.
    try {
      requireFreeLlm();
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e), code: e instanceof FreeLlmError ? `freellm_${e.code}` : "freellm_failed" }, { status: 409 });
    }
    const refused = consentDenied(req, "ask", freellmRecipient());
    if (refused) return refused;
  }
  // Only the header counts: a consent field in the body is never trusted.
  const consent = req.headers.get(CONSENT_HEADER) ?? undefined;
  // The answer is in the spoken language the user set, else the question's own, else the
  // interface's; it travels as `lang` so the voice can match it.
  // The prompt names a language only when one is known; otherwise it says "the language the user
  // speaks". The `lang` header is always one of the five (English when nothing tells).
  const known = answerLanguage(question, body.language, req.headers.get("accept-language"));
  const lang = known ?? "en";
  // Local: the screen helper of the setup for this computer, and whether it reads the picture or only text
  let helper: LocalHelper | undefined;
  if (provider === "local") {
    try {
      helper = await resolveLocalHelper(body.setup, question, sees);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
    }
  }
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let said = "";
  // The user's Stop (the panel aborts its request) and a page that went away both end the model's
  // work here: the provider call below carries this signal, so a local model stops generating.
  req.signal?.addEventListener("abort", () => abort.abort());
  if (req.signal?.aborted) abort.abort();
  // Resume after Stop: the conversation ends with the part of the answer the user saw; the model is
  // told to carry on from it instead of being asked the question a second time. The language, the
  // helper and the screenshots above were all chosen from the question itself.
  const carryOn = resumeQuestion(body.history, body.resume);
  const ask: BuddyAskRequest = { ...body, question: carryOn ?? question, images, screens, consent, sees, language: known ?? "auto" };
  // A plain request for a drawing or a 3D model is answered with one (lib/buddy/draw.ts): it needs no screenshot.
  const drawing = carryOn ? null : wantsDrawing(question);
  // On this PC a setup may answer with one model and place the points with another (lib/buddy/pointer.ts).
  const pointer = provider === "local" && !drawing && helper?.pictures && !isPointOnly(question) ? helper.pointer : undefined;
  const whereIs = async (label: string) => {
    let reply = "";
    // A tag is short and the answer's voice waits for it: a few tokens and a few seconds, never the answer's own limits.
    const limit = AbortSignal.any([abort.signal, AbortSignal.timeout(POINTER_MS)]);
    const shape = { system: buddySystemPrompt(screens, known ?? "auto", { pictures: true }), maxTokens: POINTER_MAX_TOKENS };
    for await (const piece of askBuddy("local", { ...ask, question: pointQuestion(label), history: [] }, limit, { model: pointer!, pictures: true, at: helper?.pointerAt }, shape)) reply += piece;
    return reply;
  };
  // Made inside the stream: a refused consent throws here and must reach the bubble as an error line.
  const pieces = () => drawing
    ? drawnAnswer((shape, signal) => askBuddy(provider, ask, signal, helper, shape), { kind: drawing, language: known ?? "auto", lang, signal: abort.signal })
    : pointer
      ? withPointer(askBuddy(provider, ask, abort.signal, helper), whereIs, () => abort.signal.aborted)
      : askBuddy(provider, ask, abort.signal, helper);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const piece of pieces()) {
          if (provider !== "local") said += piece;
          controller.enqueue(encoder.encode(piece));
        }
        // A placeholder the question did not contain ("[PERSON_NAME]"): a service on the way hid a name
        // before the model saw it. The answer is already on screen, so the reason follows it.
        if (placeholderLeaks(said, question).length) controller.enqueue(encoder.encode(`\n\n${okfText(lang)("outRedacted")}`));
      } catch (e) {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(`\n[ERROR] ${e instanceof Error ? e.message : String(e)}`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    // X-Buddy-Sees "text": no picture went to the model, so the page asks for no point on screen
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Buddy-Provider": provider, "X-Buddy-Lang": lang, "X-Buddy-Resume": carryOn ? "1" : "0", "X-Buddy-Sees": drawing || sees === false || (helper && !helper.pictures) ? "text" : "screen" },
  });
}
