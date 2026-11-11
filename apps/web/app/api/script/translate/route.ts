import { NextResponse } from "next/server";
import { parseScript, serializeScript, type Script } from "@filow/core";
import { requireEngine } from "@/lib/engineAuth";
import { openRouterChat } from "@/lib/openrouter";
import { GENERATE_TEXT_MODEL, scriptRecipient } from "@/lib/generate/providers";
import { consentDenied } from "@/lib/buddy/outbound";
import { freellmChat, scriptCloud } from "@/lib/freellm";
import { anonymizeRequest, placeholderLeaks, restore } from "@/lib/pii/guard";
import { keepTimeTargets, TRANSLATE_LANGS } from "@/lib/translateScript";
import { LocalTranslateError, localTranslateState, translateScriptLocal } from "@/lib/translateLocal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// a long outline on a laptop without a graphics card: many small requests, one after the other
export const maxDuration = 900;

const MAX_CHARS = 20000;

const lineCount = (s: Script) => ({ sections: s.sections.length, points: s.sections.reduce((n, x) => n + x.bullets.length, 0) });

/**
 * Where a translation can run now. `local`: this PC, with the model named, or why not ("ollama_down":
 * Ollama does not answer; "no_model": none of the translation models is installed). `cloud`: the
 * service the user picked for scripts (the editor names who receives the text from its own list).
 */
export async function GET(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  return NextResponse.json({ local: await localTranslateState(), cloud: scriptCloud(), offline: process.env.FILOW_OFFLINE === "1" });
}

/**
 * Translates a script (the "# Section / - point" text of the editor) into another language, keeping
 * the structure: same number of sections and points, same order, nothing added or dropped. Engine
 * token required, like every spend endpoint. The editor shows the result; the user still saves.
 *
 * `provider`: "local" (the default: a model on this PC through Ollama, nothing leaves the computer,
 * no consent needed), or the cloud the user chose ("cloud" = the one picked for scripts, "openrouter",
 * "freellm"), which needs the recorded yes. One is never used instead of the other: when the local
 * path cannot run the answer says why (`unavailable`) and the caller offers the choice.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  let body: { text?: string; to?: string; provider?: string };
  try {
    body = (await req.json()) as { text?: string; to?: string; provider?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const to = body.to && Object.hasOwn(TRANSLATE_LANGS, body.to) ? body.to : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!to || !text) return NextResponse.json({ error: "text and a supported `to` language required" }, { status: 400 });
  if (text.length > MAX_CHARS) return NextResponse.json({ error: `at most ${MAX_CHARS} characters` }, { status: 413 });
  const source = parseScript(text);
  const counts = lineCount(source);

  const wanted = body.provider === "cloud" ? scriptCloud() : body.provider;
  if (wanted !== "openrouter" && wanted !== "freellm") {
    // On this PC. No masking (nothing leaves) and no consent (there is no recipient).
    const state = await localTranslateState();
    if (!state.ok) return NextResponse.json({ unavailable: state.reason, error: state.reason === "no_model" ? "No local translation model is installed." : "Ollama is not running." }, { status: 503 });
    try {
      const r = await translateScriptLocal(source, TRANSLATE_LANGS[to], state.model, req.signal);
      return NextResponse.json({
        text: serializeScript(keepTimeTargets(source, r.script)),
        model: `${r.model} (local)`,
        where: "local",
        cost: 0,
        structureKept: true,
        expected: counts,
        got: lineCount(r.script),
        untranslated: r.untranslated,
        untranslatedSections: r.untranslatedSections,
      });
    } catch (err) {
      const reason = err instanceof LocalTranslateError ? err.reason : "failed";
      return NextResponse.json({ unavailable: reason, error: (err as Error).message }, { status: 503 });
    }
  }

  // The cloud was asked for. Offline mode sends nothing out, and does not translate somewhere else instead.
  if (process.env.FILOW_OFFLINE === "1") return NextResponse.json({ unavailable: "disabled", model: "offline", cost: 0 });
  // The script leaves this PC: only with the user's recorded yes for this exact recipient.
  // OpenRouter, or the user's FreeLLMAPI router when they chose it for scripts (or the request names it).
  const cloud = wanted;
  const refused = consentDenied(req, "script", scriptRecipient(cloud));
  if (refused) return refused;

  const system = [
    `You translate a speaker's outline into ${TRANSLATE_LANGS[to]}.`,
    'The input is Markdown: lines starting with "# " are section titles, lines starting with "- " are points.',
    "Translate every title and every point, keeping the meaning, the tone and any product names, numbers and acronyms as they are.",
    "Keep exactly the same structure: the same number of sections and points, in the same order, one line each, same markers.",
    "Copy any HTML comment line (<!-- ... -->), any time in brackets at the end of a title, such as (3 min), and any word in square brackets, such as [FULLNAME_1], unchanged.",
    "Output only the translated Markdown, no commentary, no code fences.",
  ].join(" ");
  try {
    const { req: safe, map } = await anonymizeRequest({ transcript: text, sectionTitle: "", bullets: [] });
    const payload = {
      temperature: 0.2,
      max_tokens: 4000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: safe.transcript },
      ],
    };
    // Never one instead of the other: a FreeLLMAPI failure comes back as its own reason.
    const { content, cost, model } = cloud === "freellm" ? { ...(await freellmChat(payload)), cost: 0 } : await openRouterChat(GENERATE_TEXT_MODEL(), "text", payload);
    const cleaned = restore(content, map).replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/, "").trim();
    const out = parseScript(cleaned);
    const got = lineCount(out);
    const structureKept = got.sections === counts.sections && got.points === counts.points;
    // A masked value the model renamed ("[FULLNAME_1]" came back as "[PERSON_NAME]") can not be put
    // back. Such a line never reaches the editor: with the structure kept it is the source line again
    // (and counted); without it there is no telling which line it was, and the translation fails.
    let untranslated = 0;
    const untranslatedSections: number[] = [];
    if (placeholderLeaks(cleaned, text).length) {
      // (points that moved between sections leave no source line to take either: fail, do not guess)
      if (!structureKept || out.sections.some((s, i) => s.bullets.length !== source.sections[i].bullets.length)) {
        return NextResponse.json({ error: "The translation came back with a masked name or number that could not be put back. Nothing was changed: try again." }, { status: 502 });
      }
      const original = (line: string, from: string, section: number) => {
        if (!placeholderLeaks(line, text).length) return line;
        untranslated++;
        if (!untranslatedSections.includes(section)) untranslatedSections.push(section);
        return from;
      };
      out.sections = out.sections.map((s, i) => {
        const src = source.sections[i];
        return { ...s, title: original(s.title, src.title, i + 1), bullets: s.bullets.map((b, j) => ({ ...b, text: original(b.text, src.bullets[j].text, i + 1) })) };
      });
    }
    return NextResponse.json({ text: serializeScript(keepTimeTargets(source, out)), model, where: cloud, cost, structureKept, expected: counts, got, untranslated, untranslatedSections });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
