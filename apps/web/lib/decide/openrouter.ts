import { SYSTEM_PROMPT, buildUserPrompt, parseDecisions, type DecideRequest, type DecideResponse } from "@intelliprompter/core";

/** Cloud decisions through an OpenRouter chat model answering JSON. */
export async function decideOpenRouter(body: DecideRequest): Promise<DecideResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set. Copy .env.example to .env.local, or pick a local provider in Settings.");
  const model = process.env.OPENROUTER_DECISION_MODEL || "google/gemini-2.5-flash-lite";
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
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  const cost: number | null = typeof json?.usage?.cost === "number" ? json.usage.cost : null;
  const { decisions, unmentioned } = parseDecisions(content, body.bullets.map((b) => b.id));
  return { decisions, unmentioned, latencyMs, cost, model };
}
