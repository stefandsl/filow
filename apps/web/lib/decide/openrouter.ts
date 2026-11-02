import { SYSTEM_PROMPT, buildUserPrompt, parseDecisions, type DecideRequest, type DecideResponse } from "@filow/core";
import { openRouterChat } from "@/lib/openrouter";

/** Cloud decisions through an OpenRouter chat model answering JSON. */
export async function decideOpenRouter(body: DecideRequest): Promise<DecideResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set. Copy .env.example to .env.local, or pick a local provider in Settings.");
  const model = process.env.OPENROUTER_DECISION_MODEL || "google/gemini-2.5-flash-lite";
  const started = Date.now();
  const { content, cost, model: used } = await openRouterChat(model, "text", {
    temperature: 0,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(body) },
    ],
  });
  const latencyMs = Date.now() - started;
  const { decisions, unmentioned } = parseDecisions(content, body.bullets.map((b) => b.id));
  return { decisions, unmentioned, latencyMs, cost, model: used };
}
