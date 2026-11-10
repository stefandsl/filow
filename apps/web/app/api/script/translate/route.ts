import { NextResponse } from "next/server";
import { parseScript, serializeScript } from "@filow/core";
import { requireEngine } from "@/lib/engineAuth";
import { openRouterChat } from "@/lib/openrouter";
import { GENERATE_TEXT_MODEL, scriptRecipient } from "@/lib/generate/providers";
import { consentDenied } from "@/lib/buddy/outbound";
import { anonymizeRequest, restore } from "@/lib/pii/guard";

export const runtime = "nodejs";
export const maxDuration = 120;

const TRANSLATE_LANGS: Record<string, string> = { en: "English", it: "Italian", ro: "Romanian", ru: "Russian", de: "German", fr: "French", es: "Spanish" };
const MAX_CHARS = 20000;

/**
 * Translates a script (the "# Section / - point" text of the editor) into another language, keeping
 * the structure: same number of sections and points, same order, nothing added or dropped. Engine
 * token required, like every spend endpoint. The editor shows the result; the user still saves.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  if (process.env.FILOW_OFFLINE === "1") return NextResponse.json({ unavailable: "disabled", model: "offline", cost: 0 });
  let body: { text?: string; to?: string };
  try {
    body = (await req.json()) as { text?: string; to?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const to = body.to && Object.hasOwn(TRANSLATE_LANGS, body.to) ? body.to : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!to || !text) return NextResponse.json({ error: "text and a supported `to` language required" }, { status: 400 });
  if (text.length > MAX_CHARS) return NextResponse.json({ error: `at most ${MAX_CHARS} characters` }, { status: 413 });
  // The script leaves this PC: only with the user's recorded yes for this exact recipient.
  const refused = consentDenied(req, "script", scriptRecipient());
  if (refused) return refused;

  const source = parseScript(text);
  const counts = { sections: source.sections.length, points: source.sections.reduce((n, s) => n + s.bullets.length, 0) };
  const system = [
    `You translate a speaker's outline into ${TRANSLATE_LANGS[to]}.`,
    'The input is Markdown: lines starting with "# " are section titles, lines starting with "- " are points.',
    "Translate every title and every point, keeping the meaning, the tone and any product names, numbers and acronyms as they are.",
    "Keep exactly the same structure: the same number of sections and points, in the same order, one line each, same markers.",
    "Output only the translated Markdown, no commentary, no code fences.",
  ].join(" ");
  try {
    const { req: safe, map } = await anonymizeRequest({ transcript: text, sectionTitle: "", bullets: [] });
    const { content, cost, model } = await openRouterChat(GENERATE_TEXT_MODEL(), "text", {
      temperature: 0.2,
      max_tokens: 4000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: safe.transcript },
      ],
    });
    const cleaned = restore(content, map).replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/, "").trim();
    const out = parseScript(cleaned);
    const got = { sections: out.sections.length, points: out.sections.reduce((n, s) => n + s.bullets.length, 0) };
    const structureKept = got.sections === counts.sections && got.points === counts.points;
    return NextResponse.json({ text: serializeScript({ ...out, source: source.source }), model, cost, structureKept, expected: counts, got });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
