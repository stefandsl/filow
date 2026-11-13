import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { dataUrlBytes, MAX_IMAGE_BYTES } from "@/lib/vision/openrouter";
import { CONSENT_HEADER, consentDenied } from "@/lib/buddy/outbound";
import { askBuddy, buddyCloudRecipient, resolveBuddyProvider, resolveLocalHelper, type BuddyAskRequest, type LocalHelper } from "@/lib/buddy/providers";
import { serverAllowed } from "@/lib/modelRoles/helper";
import { answerLanguage } from "@/lib/buddy/lang";
import { drawnAnswer } from "@/lib/buddy/draw";
import { wantsDrawing } from "@/lib/buddy/visuals";
import { photoAnswer, photoOnly } from "@/lib/buddy/photo";
import { isPointOnly, pointQuestion, POINTER_MAX_TOKENS, POINTER_MS, POINTING_TOTAL_MS, withPointer } from "@/lib/buddy/pointer";
import { buddySystemPrompt, resumeQuestion } from "@/lib/buddy/prompt";
import { ASKED_SYSTEM, askedElement, askedNames, canPick, namedInQuestion, PICK_MAX_TOKENS, PICK_MS, PICK_SYSTEM, pickedIndex, pickQuestion, plainName, sanitizeElements, screenHint, withNamedPoint, withPlacedTags } from "@/lib/buddy/ground";
import { okfText } from "@/lib/buddy/text";
import { placeholderLeaks } from "@/lib/pii/guard";
import { FreeLlmError, freellmRecipient, requireFreeLlm } from "@/lib/freellm";
import { createServerTiming, logServerTiming, mark as markTiming } from "@/lib/buddy/timing";

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
  // The speed baseline (lib/buddy/timing.ts): only a request that carries the panel's run id is measured.
  const timing = createServerTiming(req.headers.get("x-filow-run"));
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
      // The user's own server (Settings > Advanced) only with the yes for it in this request; otherwise this PC answers.
      if (!serverAllowed(helper, consent)) helper = await resolveLocalHelper(body.setup, question, sees, "okfilowAnswers", false);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
    }
  }
  markTiming(timing, "helperResolved");
  if (timing) {
    timing.images = images.length;
    timing.model = helper?.model;
  }
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let said = "";
  // The user's Stop (the panel aborts its request) and a page that went away both end the model's
  // work here: the provider call below carries this signal, so a local model stops generating.
  req.signal?.addEventListener("abort", () => abort.abort());
  if (req.signal?.aborted) abort.abort();
  // What Windows names on each screen (lib/buddy/ground.ts): used below to place points and boxes, and
  // taken out of what the providers get, so the list stays on this PC whatever answers.
  const elements = images.length ? sanitizeElements(body.elements, screens.length) : [];
  // Resume after Stop: the conversation ends with the part of the answer the user saw; the model is
  // told to carry on from it instead of being asked the question a second time. The language, the
  // helper and the screenshots above were all chosen from the question itself.
  const carryOn = resumeQuestion(body.history, body.resume);
  const ask: BuddyAskRequest = { ...body, elements: undefined, question: carryOn ?? question, images, screens, consent, sees, language: known ?? "auto" };
  // A plain request for a drawing or a 3D model is answered with one (lib/buddy/draw.ts): it needs no screenshot.
  const drawing = carryOn ? null : wantsDrawing(question);
  // On this PC a setup may answer with one model and place the points with another (lib/buddy/pointer.ts).
  const pointer = provider === "local" && !drawing && helper?.pictures && !isPointOnly(question) ? helper.pointer : undefined;
  // Everything that places points after the answer shares one allowance, so three hard labels cannot hold the voice for long.
  let pointingSince = 0;
  const pointingLimit = (ms: number) => {
    pointingSince ||= Date.now();
    return AbortSignal.any([abort.signal, AbortSignal.timeout(Math.max(1, Math.min(ms, POINTING_TOTAL_MS - (Date.now() - pointingSince))))]);
  };
  const whereIs = async (label: string) => {
    let reply = "";
    // A tag is short and the answer's voice waits for it: a few tokens and a few seconds, never the answer's own limits.
    const limit = pointingLimit(POINTER_MS);
    const shape = { system: buddySystemPrompt(screens, known ?? "auto", { pictures: true }), maxTokens: POINTER_MAX_TOKENS };
    for await (const piece of askBuddy("local", { ...ask, question: pointQuestion(label), history: [] }, limit, { model: pointer!, pictures: true, at: helper?.pointerAt }, shape)) reply += piece;
    return reply;
  };
  // A label no name on screen has the words of: the answering model chooses from the names, without a
  // picture (lib/buddy/ground.ts). Only here, on this PC: the names never go to an online provider.
  const choose = async (system: string, label: string, names: string[], model: string) => {
    let reply = "";
    const limit = pointingLimit(PICK_MS);
    const shape = { system, maxTokens: PICK_MAX_TOKENS, temperature: 0, pictures: false };
    for await (const piece of askBuddy("local", { ...ask, question: pickQuestion(label, names), history: [], images: [] }, limit, { model, pictures: false }, shape)) reply += piece;
    return reply;
  };
  const whichOf = (label: string, names: string[]) => choose(PICK_SYSTEM, label, names, helper!.model);
  // The panel's second, narrow request (an answer that pointed at nothing): before the pointing model
  // searches the picture, the answering model says which named thing the question was about, if any.
  // Measured on reworded questions: right for 79%, and 0 ("about none of them") for 39 of 40 questions about nothing on screen.
  async function* askedThing(otherwise: () => AsyncIterable<string>): AsyncGenerator<string> {
    try {
      const answering = await resolveLocalHelper(body.setup, "", sees);
      const on = screens.find((s) => s.cursor)?.index ?? 1;
      // Every screen sent ("All my screens"), the one with the mouse first: a question about a window on
      // another screen must not be pointed at a namesake on this one (measured 12 Nov: the taskbar's
      // "Esplora file" was chosen for questions about an Explorer window on the other screen).
      const names = askedNames(elements, on);
      if (canPick(answering.model) && names.length) {
        const chosen = pickedIndex(await choose(ASKED_SYSTEM, question.split("\n")[0], names, answering.model), names.length);
        const one = askedElement(elements, chosen === null ? undefined : names[chosen]);
        if (one) {
          yield `[POINT:${Math.round((one.x1 + one.x2) / 2)},${Math.round((one.y1 + one.y2) / 2)}:${plainName(one.name).replace(/[[\]:]/g, " ").slice(0, 60)}:screen${one.screen}]`;
          return;
        }
      }
    } catch {
      // no choice: the pointing model looks, as before
    }
    if (!abort.signal.aborted) yield* otherwise();
  }
  // The thing the question itself names, when Windows lists it: the answering model on this PC is told
  // where it is (only names the question already holds), and an answer that still points at nothing gets the point.
  // (not when an answer is carried on after Stop: its question was already asked, hint and all)
  const named = elements.length && !drawing && !carryOn && !isPointOnly(question) ? namedInQuestion(question, elements) : [];
  const asked: BuddyAskRequest = provider === "local" && named.length ? { ...ask, question: question + screenHint(named, screens.length) } : ask;
  // Made inside the stream: a refused consent throws here and must reach the bubble as an error line.
  const pieces = () => drawing
    ? drawnAnswer((shape, signal) => askBuddy(provider, ask, signal, helper, shape), { kind: drawing, language: known ?? "auto", lang, signal: abort.signal })
    : pointer
      // boxes and circles are placed as they stream; the points wait for the pointing model, which is asked only for what Windows does not name
      ? withNamedPoint(withPointer(withPlacedTags(askBuddy(provider, asked, abort.signal, helper, undefined, timing), elements, { points: false }), whereIs, () => abort.signal.aborted, elements, helper && canPick(helper.model) ? whichOf : undefined), named, screens.length)
      : provider === "local" && elements.length && helper?.pictures && isPointOnly(question)
        ? askedThing(() => withPlacedTags(askBuddy(provider, ask, abort.signal, helper, undefined, timing), elements))
        : withNamedPoint(withPlacedTags(askBuddy(provider, asked, abort.signal, helper, undefined, timing), elements), named, screens.length);
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
        logServerTiming(timing);
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
