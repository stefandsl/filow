// One place for OpenRouter chat calls: model fallbacks (OpenRouter's `models` list, tried in order
// when the first one errors or is rate-limited upstream) and a short retry on 429 / 5xx. Google's
// free-tier models on the shared pool return 429 "temporarily rate-limited upstream" at busy hours;
// without this every Screen Sense frame or decision failed outright.

import { makerHosts, sameMaker } from "@/lib/buddy/outbound";

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
  // A fallback is also run the same way: by the maker when the configured model is, else by a host OpenRouter picks.
  const pinned = Boolean(makerHosts(model));
  return [model, ...fallbackModels(kind).filter((m) => m !== model && sameMaker(m, model) && Boolean(makerHosts(m)) === pinned)].slice(0, 3);
}

/**
 * The `provider` routing object of a request (openrouter.ai/docs, "Provider Routing"). When every
 * model is run by its maker on OpenRouter (`makerHosts`), the request may only go to the maker's
 * own hosts, with no fallback to another company: the company the notice names is the one that runs
 * it. Otherwise OpenRouter picks the host, and the recipient says so (`picked` in lib/buddy/outbound.ts).
 * `sort` (OPENROUTER_PROVIDER_SORT=latency|throughput|price; empty = OpenRouter's default) orders
 * whichever hosts are allowed.
 */
export function openRouterProvider(models: string[]): Record<string, unknown> | undefined {
  const sortEnv = process.env.OPENROUTER_PROVIDER_SORT;
  const sort = sortEnv !== "" ? { sort: sortEnv || "throughput" } : {};
  const hosts = models.map(makerHosts);
  const pinned = models.length > 0 && hosts.every((h) => h !== null);
  const only = pinned ? [...new Set(hosts.flatMap((h) => h ?? []))] : [];
  const out = { ...(only.length ? { only, allow_fallbacks: false } : {}), ...sort };
  return Object.keys(out).length ? out : undefined;
}

/**
 * The chat endpoint. OPENROUTER_BASE_URL points it at a local mock for end-to-end checks
 * (docs/okfilow/OUTBOUND.md: count what would have left the PC without paying for a call).
 */
export function openRouterChatUrl(): string {
  const base = (process.env.OPENROUTER_BASE_URL || "").trim().replace(/\/+$/, "");
  return `${base || "https://openrouter.ai/api/v1"}/chat/completions`;
}

/** `{ provider }` to spread into a request body, or nothing. */
export function withProvider(models: string[]): { provider?: Record<string, unknown> } {
  const provider = openRouterProvider(models);
  return provider ? { provider } : {};
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
    const res = await fetch(openRouterChatUrl(), {
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
        ...payload,
        // After the payload: no caller may widen who runs the model.
        ...withProvider(models),
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
