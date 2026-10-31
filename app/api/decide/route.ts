import { NextResponse } from "next/server";
import type { DecideRequest, DecideResponse, Decision } from "@/lib/types";

/**
 * One OpenRouter call per tick. The model gets the recent transcript and the
 * section's still-open talking points, and must say for each one whether the
 * speaker has STARTED covering that idea (paraphrase counts, exact words don't
 * matter). It answers with JSON only.
 */

const SYSTEM_PROMPT = `You are a strict real-time classifier inside a teleprompter. You are called twice a second.

INPUT
- A live speech transcript: the last ~900 characters, most recent at the end. It contains recognition errors, filler words, restarts and sometimes wrong word boundaries. The speaker may talk in any language; the talking points may be in a different language than the speech.
- OPEN POINTS: the talking points of the current section the speaker has not covered yet. These are the only ones you decide on.
- COVERED POINTS: points of this section already checked off. Context only. Speech about them must NOT be credited to an open point.
- UPCOMING POINTS: the next section. Context only. If the speech matches an upcoming point rather than an open one, the open one stays not started.

TASK
For EACH open point decide: has the speaker STARTED talking about that idea?
- Judge the idea, not the wording. Paraphrases, synonyms, examples and translations count.
- Only the transcript counts. Never assume the speaker will get to a point.
- "I'm going to talk about X" is an announcement, not a start, unless X is then actually discussed.
- A single shared keyword is not enough. The speaker must be making the point, not just using one of its words.
- When two open points are similar, credit only the one that best matches what was actually said.
- Prefer a false "not started" over a false "started": a wrong check-off hides a point the speaker still needs.

CONFIDENCE RUBRIC
- 0.90-1.00: the point is clearly being made, in substance.
- 0.70-0.89: very likely, the idea is there but phrased loosely or cut off by the transcript window.
- 0.40-0.69: ambiguous. Shared vocabulary, or an announcement without content.
- 0.10-0.39: unlikely. Tangential or wrong section.
- 0.00-0.09: not mentioned.
Set "started" to true only when confidence >= 0.70.

OUTPUT
JSON only, no prose, no markdown, exactly:
{"decisions":[{"id":"<point id>","started":true|false,"confidence":<0..1>}]}
Include every open point id exactly once, nothing else.`;

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

  const list = (items: string[] | undefined, empty: string) =>
    items?.length ? items.map((t) => `- ${t}`) : [`- (${empty})`];

  const userPrompt = [
    `Current section: ${body.sectionTitle}`,
    body.language ? `Language hint: ${body.language}` : null,
    "",
    "OPEN POINTS (decide on these):",
    ...body.bullets.map((b) => `- id=${b.id}: ${b.text}`),
    "",
    "COVERED POINTS (context only):",
    ...list(body.covered, "none yet"),
    "",
    "UPCOMING POINTS, next section (context only):",
    ...list(body.upcoming, "this is the last section"),
    "",
    "TRANSCRIPT (most recent at the end):",
    `"""${body.transcript}"""`,
  ]
    .filter((l) => l !== null)
    .join("\n");

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
