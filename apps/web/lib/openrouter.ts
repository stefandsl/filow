// One place for OpenRouter chat calls: model fallbacks (OpenRouter's `models` list, tried in order
// when the first one errors or is rate-limited upstream) and a short retry on 429 / 5xx. Google's
// free-tier models on the shared pool return 429 "temporarily rate-limited upstream" at busy hours;
// without this every Screen Sense frame or decision failed outright.

import { sameMaker } from "@/lib/buddy/outbound";

/** Extra models tried after the configured one. Override with OPENROUTER_FALLBACK_MODELS (comma list). */
export function fallbackModels(kind: "text" | "vision"): string[] {
  const env = process.env.OPENROUTER_FALLBACK_MODELS;
  if (env !== undefined) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return kind === "vision" ? ["google/gemini-2.5-flash", "openai/gpt-4o-mini"] : ["google/gemini-2.0-flash-001", "openai/gpt-4o-mini"];
}

/**
 * The `models` list sent to OpenRouter: the configured model, then fallbacks from the SAME maker only.
 * The user is told, and says yes to, one maker (lib/buddy/outbound.ts); a fallback to another maker
 * would send their content to a company the notice never named.
 * OpenRouter accepts at most 3 entries (primary + 2 fallbacks); more is a 400.
 */
export function routedModels(model: string, kind: "text" | "vision"): string[] {
  return [model, ...fallbackModels(kind).filter((m) => m !== model && sameMaker(m, model))].slice(0, 3);
}

export type OpenRouterResult ={ json: Record<string, unknown>; content: string; cost: number | null; model: string };

/**
 * POST /chat/completions with `models: [model, ...fallbacks]`, retrying once or twice on 429 and 5xx
 * (0.8 s, 2 s). Returns the model that actually answered.
 */
export async function openRouterChat(model: string, kind: "text" | "vision", payload: Record<string, unknown>, opts: { retries?: number } = {}): Promise<OpenRouterResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");
  const models = routedModels(model, kind);
  const retries = opts.retries ?? 2;
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.PUBLIC_ORIGIN || "http://localhost:4747",
        "X-Title": "Filow",
      },
      body: JSON.stringify({
        model: models[0],
        models,
        usage: { include: true },
        // Route to the fastest provider of each model (OPENROUTER_PROVIDER_SORT=latency|throughput|price; empty = OpenRouter's default).
        ...(process.env.OPENROUTER_PROVIDER_SORT !== "" ? { provider: { sort: process.env.OPENROUTER_PROVIDER_SORT || "throughput" } } : {}),
        ...payload,
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      const choices = json.choices as Array<{ message?: { content?: string } }> | undefined;
      const usage = json.usage as { cost?: unknown } | undefined;
      return {
        json,
        content: choices?.[0]?.message?.content ?? "",
        cost: typeof usage?.cost === "number" ? usage.cost : null,
        model: typeof json.model === "string" ? json.model : models[0],
      };
    }
    lastError = `OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`;
    const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
    if (!retryable || attempt === retries) break;
    await new Promise((r) => setTimeout(r, attempt === 0 ? 800 : 2000));
  }
  throw new Error(lastError);
}
