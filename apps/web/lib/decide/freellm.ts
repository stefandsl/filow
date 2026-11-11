import { SYSTEM_PROMPT, buildUserPrompt, parseDecisions, type DecideRequest, type DecideResponse } from "@filow/core";
import { freellmChat } from "@/lib/freellm";

/**
 * Take decisions through the user's FreeLLMAPI router (lib/freellm.ts). No `response_format`: not
 * every free provider accepts it, and the prompt already asks for JSON only. Free tiers are slower
 * and rate limited, so a take on FreeLLMAPI ticks later than on this PC; a failure carries its reason.
 */
export async function decideFreeLlm(body: DecideRequest, signal?: AbortSignal): Promise<DecideResponse> {
  const started = Date.now();
  const { content, model } = await freellmChat({
    temperature: 0,
    max_tokens: 500,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(body) },
    ],
  }, { signal, timeoutMs: 20_000 });
  const { decisions, unmentioned } = parseDecisions(content, body.bullets.map((b) => b.id));
  return { decisions, unmentioned, latencyMs: Date.now() - started, cost: 0, model };
}
