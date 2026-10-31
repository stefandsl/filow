import { NextResponse } from "next/server";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseDecisions,
  type DecideRequest,
  type DecideResponse,
} from "@intelliprompter/core";

/**
 * One OpenRouter call per engine tick. Prompt and parser live in
 * packages/core/src/prompt.ts so they can be tested without a server.
 */
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

  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.PUBLIC_ORIGIN || "http://localhost:4747",
      "X-Title": "Intelliprompter",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 500,
      response_format: { type: "json_object" },
      usage: { include: true },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(body) },
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
  const cost: number | null = typeof json?.usage?.cost === "number" ? json.usage.cost : null;

  const { decisions, unmentioned } = parseDecisions(content, body.bullets.map((b) => b.id));
  return NextResponse.json<DecideResponse>({ decisions, unmentioned, latencyMs, cost, model });
}
