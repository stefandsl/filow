import { NextResponse } from "next/server";
import type { DecideRequest, DecideResponse, Decision } from "@/lib/types";

/**
 * One OpenRouter call per tick. The model gets the recent transcript and the
 * section's still-open talking points, and must say for each one whether the
 * speaker has STARTED covering that idea (paraphrase counts, exact words don't
 * matter). It answers with JSON only.
 */

const SYSTEM_PROMPT = `You are a strict real-time classifier for a teleprompter.
You receive a live speech transcript (it may contain recognition errors, filler words and restarts) and a list of talking points the speaker still has to cover.

For EACH talking point decide: has the speaker STARTED talking about that idea?
- Judge the idea, not the exact wording. Paraphrases count.
- Only the transcript counts. Do not assume the speaker will get to it.
- Being "about to" talk about it does not count. Mentioning a closely related idea in passing does not count unless it clearly is that point.
- Be conservative: a false "started" hides a point the speaker still needs.

Respond with JSON only, no prose, in exactly this shape:
{"decisions":[{"id":"<bullet id>","started":true|false,"confidence":<0..1>}]}
Include every bullet id exactly once. "confidence" is how sure you are that the point has been started (1 = certain started, 0 = certain not).`;

export async function POST(req: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not set. Copy .env.example to .env.local." },
      { status: 500 },
    );
  }
  const model = process.env.OPENROUTER_DECISION_MODEL || "google/gemini-2.5-flash-lite";

  const body = (await req.json()) as DecideRequest;
  if (!body?.bullets?.length) {
    return NextResponse.json<DecideResponse>({ decisions: [], latencyMs: 0, cost: 0, model });
  }

  const userPrompt = [
    `Section: ${body.sectionTitle}`,
    "",
    "Talking points still open:",
    ...body.bullets.map((b) => `- id=${b.id}: ${b.text}`),
    "",
    "Recent transcript (most recent at the end):",
    `"""${body.transcript}"""`,
  ].join("\n");

  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:4747",
      "X-Title": "Intelliprompter",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
      usage: { include: true },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const latencyMs = Date.now() - started;

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `OpenRouter ${res.status}: ${text}` }, { status: 502 });
  }

  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  const cost: number = typeof json?.usage?.cost === "number" ? json.usage.cost : 0;

  const decisions = parseDecisions(content, body.bullets.map((b) => b.id));
  return NextResponse.json<DecideResponse>({ decisions, latencyMs, cost, model });
}

function parseDecisions(content: string, ids: string[]): Decision[] {
  // Models sometimes wrap JSON in code fences despite json_object mode.
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: { decisions?: unknown } = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        /* fall through to empty */
      }
    }
  }

  const byId = new Map<string, Decision>();
  if (Array.isArray(parsed.decisions)) {
    for (const d of parsed.decisions as Array<Record<string, unknown>>) {
      const id = String(d.id ?? "");
      if (!ids.includes(id)) continue;
      const confidence = clamp(Number(d.confidence));
      byId.set(id, { id, started: Boolean(d.started), confidence });
    }
  }
  // Every requested id gets an answer; missing ones stay "not started".
  return ids.map((id) => byId.get(id) ?? { id, started: false, confidence: 0 });
}

function clamp(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
