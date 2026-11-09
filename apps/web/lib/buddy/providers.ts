// OK Filow answer providers. Local: a vision model in Ollama (Qwen3-VL 8B, else Gemma 4), nothing
// leaves the PC. Cloud: OpenRouter multimodal, only when the user picked it. An explicit choice
// never falls back to the other provider; errors go back to the bubble.
import { OLLAMA_URL } from "@/lib/decide/clef";
import { buddySystemPrompt, trimHistory, type BuddyScreen, type BuddyTurn } from "./prompt";

export type BuddyProviderId = "local" | "cloud";

export type BuddyAskRequest = {
  question: string;
  /** JPEG data URLs, one per display, in screen order. */
  images: string[];
  screens: BuddyScreen[];
  history?: BuddyTurn[];
  language?: string;
  provider?: string;
};

/** Vision models that can read a screenshot, best first. The first one pulled in Ollama is used. */
// Speed first: the 2B fits fully on an 8 GB GPU and answers in about 0.5 s; the 8B splits onto the CPU.
export const BUDDY_LOCAL_CANDIDATES = ["qwen3-vl:2b", "qwen3-vl:4b", "gemma4:e2b", "gemma4:e4b", "qwen3-vl:8b"];

// Only OK Filow's own setting counts: the general text model (GENERATE_LOCAL_MODEL) may not see images.
export function pickLocalModel(installed: string[], configured = process.env.BUDDY_LOCAL_MODEL, candidates = BUDDY_LOCAL_CANDIDATES): string {
  if (configured) return configured;
  const names = new Set(installed.flatMap((n) => [n, n.replace(/:latest$/, "")]));
  return candidates.find((c) => names.has(c)) ?? "gemma4:e4b";
}

/** Drawings and 3D models: the 2B loops and writes broken JSON (measured), so the biggest model draws. */
export const BUDDY_DRAW_CANDIDATES = ["qwen3-vl:8b", "qwen3-vl:4b", "gemma4:e4b", ...BUDDY_LOCAL_CANDIDATES];
export const wantsVisual = (q: string) => /\b(draw|drawing|sketch|diagram|illustrat\w*|3d|model|disegn\w*|schema|modello)\b/i.test(q);

async function localModel(candidates = BUDDY_LOCAL_CANDIDATES): Promise<string> {
  if (process.env.BUDDY_LOCAL_MODEL) return pickLocalModel([]);
  try {
    const res = await fetch(`${OLLAMA_URL()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    return pickLocalModel((json.models ?? []).map((m) => m.name), undefined, candidates);
  } catch {
    return pickLocalModel([], undefined, candidates);
  }
}
/** Loads the local vision model and keeps it loaded for 30 minutes (empty prompt: Ollama only loads). */
export async function warmLocalModel(): Promise<{ model: string; ok: boolean }> {
  const model = await localModel();
  try {
    const res = await fetch(`${OLLAMA_URL()}/api/generate`, {
      method: "POST",
      signal: AbortSignal.timeout(180_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, keep_alive: "30m" }),
    });
    return { model, ok: res.ok };
  } catch {
    return { model, ok: false };
  }
}

export const BUDDY_CLOUD_MODEL =() => process.env.BUDDY_CLOUD_MODEL || "google/gemini-2.5-flash";

/** Offline mode always means local; otherwise the request's choice, else BUDDY_PROVIDER, else local. */
export function resolveBuddyProvider(requested?: string): BuddyProviderId {
  if (process.env.FILOW_OFFLINE === "1") return "local";
  if (requested === "local" || requested === "cloud") return requested;
  return process.env.BUDDY_PROVIDER === "cloud" ? "cloud" : "local";
}

/**
 * Ollama's Qwen3-VL tags are the Thinking build: they think for 300-2800 hidden tokens even with
 * think:false (measured 30-97 s per answer on an RTX 3070). An already-closed think block as the
 * start of the reply skips it: the first word arrives in about 0.2 s once the model is loaded.
 */
export function noThinkPrefill(model: string): Array<{ role: "assistant"; content: string }> {
  return model.startsWith("qwen3-vl") ? [{ role: "assistant", content: "<think>\n\n</think>\n\n" }] : [];
}

const base64Of =(dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/** Reads newline-delimited chunks from a fetch body. */
async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

export async function* askOllama(req: BuddyAskRequest, signal?: AbortSignal): AsyncGenerator<string> {
  const model = await localModel(wantsVisual(req.question) ? BUDDY_DRAW_CANDIDATES : BUDDY_LOCAL_CANDIDATES);
  const history = trimHistory(req.history ?? []).map((t) => ({ role: t.role, content: t.text }));
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL()}/api/chat`, {
      method: "POST",
      // A hung Ollama must not leave OK Filow "thinking" forever; 3 min covers a cold load on a CPU.
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        // Qwen3-VL and Gemma think out loud by default: minutes of hidden reasoning and sometimes an empty reply.
        think: false,
        keep_alive: "30m",
        // num_predict: a looping small model once ran 5,800 tokens (45 s); a real answer with a drawing is about 500.
        options: { temperature: 0.3, num_ctx: 8192, num_predict: 1500 },
        messages: [
          { role: "system", content: buddySystemPrompt(req.screens, req.language ?? "") },
          ...history,
          // Gemma reads images placed on the message before the text.
          { role: "user", content: req.question, images: req.images.map(base64Of) },
          ...noThinkPrefill(model),
        ],
      }),
    });
  } catch (e) {
    if (signal?.aborted) return;
    throw new Error(`Ollama is not running on this PC. Install it with the screen helper model (Qwen3-VL) in Settings > Local models, or set "Answers from" to Cloud in the OK Filow panel.`, { cause: e });
  }
  if (res.status === 404) throw new Error(`The screen helper model (${model}) is not installed. Get it in Settings > Local models, or set "Answers from" to Cloud in the OK Filow panel.`);
  if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  for await (const line of lines(res.body)) {
    let json: { message?: { content?: string }; error?: string; done?: boolean };
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    if (json.error) throw new Error(`Ollama: ${json.error}`);
    if (json.message?.content) yield json.message.content;
    if (json.done) return;
  }
}

export async function* askOpenRouter(req: BuddyAskRequest, signal?: AbortSignal): AsyncGenerator<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("No OpenRouter key: add OPENROUTER_API_KEY, or switch the buddy to the local model.");
  const history = trimHistory(req.history ?? []).map((t) => ({ role: t.role, content: t.text }));
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.PUBLIC_ORIGIN || "http://localhost:4747",
      "X-Title": "Filow",
    },
    body: JSON.stringify({
      model: BUDDY_CLOUD_MODEL(),
      stream: true,
      temperature: 0.3,
      // 500 cut a photosynthesis drawing off mid-JSON (953 chars); a spoken answer plus a drawing is about 500-900 tokens.
      max_tokens: 1500,
      messages: [
        { role: "system", content: buddySystemPrompt(req.screens, req.language ?? "") },
        ...history,
        {
          role: "user",
          content: [{ type: "text", text: req.question }, ...req.images.map((url) => ({ type: "image_url", image_url: { url } }))],
        },
      ],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  for await (const line of lines(res.body)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    try {
      const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string } };
      if (json.error) throw new Error(`OpenRouter: ${json.error.message ?? "error"}`);
      const piece = json.choices?.[0]?.delta?.content;
      if (piece) yield piece;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("OpenRouter")) throw e;
    }
  }
}

export function askBuddy(provider: BuddyProviderId, req: BuddyAskRequest, signal?: AbortSignal): AsyncGenerator<string> {
  return provider === "cloud" ? askOpenRouter(req, signal) : askOllama(req, signal);
}
