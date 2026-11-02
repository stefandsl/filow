// Per-slide generators for /api/script/generate: OpenRouter (cloud) and Ollama (local).
// Both return the same shape; the route picks one and wraps it with the PII guard.
import { buildGenerateUserPrompt, GENERATE_SYSTEM_PROMPT, parseGenerated, type GeneratedSlide, type SlideInput } from "@filow/core";
import { OLLAMA_URL } from "@/lib/decide/clef";
import { openRouterChat } from "@/lib/openrouter";

export type SlideResult = { generated: GeneratedSlide; cost: number | null; model: string };

export const GENERATE_TEXT_MODEL = () => process.env.OPENROUTER_GENERATE_MODEL || "google/gemini-2.5-flash-lite";
export const GENERATE_VISION_MODEL = () => process.env.OPENROUTER_GENERATE_VISION_MODEL || "google/gemini-2.5-flash";
/** Gemma 4 E2B: text + image, Italian included, ~5-7 GB, fits 8 GB RAM. E4B on 16 GB, qwen3-vl:2b as the light fallback. */
export const GENERATE_LOCAL_MODEL = () => process.env.GENERATE_LOCAL_MODEL || "gemma4:e2b";

const fallbackTitle = (s: SlideInput) => s.title?.trim() || `Slide ${s.index + 1}`;

export async function generateSlideOpenRouter(slide: SlideInput, opts: { language?: string; total: number }): Promise<SlideResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set; pick a local model in Settings or add the key.");
  const model = slide.imageBase64 ? GENERATE_VISION_MODEL() : GENERATE_TEXT_MODEL();
  const text = buildGenerateUserPrompt(slide, opts);
  const content: unknown = slide.imageBase64
    ? [
        { type: "text", text },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${slide.imageBase64}` } },
      ]
    : text;
  const { content: answer, cost, model: used } = await openRouterChat(model, slide.imageBase64 ? "vision" : "text", {
    temperature: 0.3,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: GENERATE_SYSTEM_PROMPT },
      { role: "user", content },
    ],
  });
  return { generated: parseGenerated(answer, fallbackTitle(slide)), cost, model: used };
}

/**
 * Ollama /api/chat. For Gemma 4 the image goes on the message before the text (the model reads
 * it first) and num_ctx is raised so OCR-like slides keep their visual tokens.
 */
export async function generateSlideOllama(slide: SlideInput, opts: { language?: string; total: number }): Promise<SlideResult> {
  const model = GENERATE_LOCAL_MODEL();
  const message: Record<string, unknown> = { role: "user", content: buildGenerateUserPrompt(slide, opts) };
  if (slide.imageBase64) message.images = [slide.imageBase64];
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0.3, num_ctx: slide.imageBase64 ? 8192 : 4096 },
        messages: [{ role: "system", content: GENERATE_SYSTEM_PROMPT }, message],
      }),
    });
  } catch {
    throw new Error(`Ollama not reachable at ${OLLAMA_URL()}. Start Ollama and pull ${model} in Settings > Local models.`);
  }
  if (res.status === 404) throw new Error(`Model ${model} not found in Ollama. Pull it in Settings > Local models.`);
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { message?: { content?: string } };
  return { generated: parseGenerated(json.message?.content ?? "", fallbackTitle(slide)), cost: 0, model: `${model} (local)` };
}

export type GenerateProviderId = "openrouter" | "ollama";

/** Offline switch forces Ollama; otherwise the request's choice, else GENERATE_PROVIDER, else OpenRouter. */
export function resolveGenerateProvider(requested?: string): GenerateProviderId {
  if (process.env.FILOW_OFFLINE === "1") return "ollama";
  if (requested === "ollama" || requested === "openrouter") return requested;
  const env = process.env.GENERATE_PROVIDER;
  if (env === "ollama" || env === "openrouter") return env;
  // A local decision provider implies a local-first user: generate locally too.
  if ((process.env.DECISION_PROVIDER || "").startsWith("clef-local")) return "ollama";
  return "openrouter";
}
