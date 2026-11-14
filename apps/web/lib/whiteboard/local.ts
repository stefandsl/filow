import { withLocalDate } from "../../../desktop/prompt-date";
// The whiteboard's two small questions to the models on this PC (server side): "what is wrong in
// this picture of the board" (a vision model, only when one is installed) and "which elements does
// this follow-up change" (the lesson's own local model). Both go to the local Ollama only; nothing
// here can reach an online model.
import { OLLAMA_URL } from "@/lib/decide/clef";

/** Vision models that may look at the board, in order: small first (it answers in about a second). */
export const VISION_MODELS = ["lfm3-vl"];

export async function installedModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_URL()}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    return (json.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/** The vision model to use, or null: WHITEBOARD_VISION_MODEL, else the first of VISION_MODELS installed. */
export function visionModel(installed: string[]): string | null {
  const wanted = process.env.WHITEBOARD_VISION_MODEL;
  if (wanted === "off") return null;
  const names = installed.map((n) => n.replace(/:latest$/, ""));
  if (wanted) return names.includes(wanted.replace(/:latest$/, "")) ? wanted : null;
  return VISION_MODELS.find((m) => names.includes(m)) ?? null;
}

/** One JSON answer from a local model, held to `schema`. */
export async function localJson(model: string, system: string, user: string, schema: unknown, opts: { images?: string[]; timeoutMs: number; maxTokens?: number; at?: { base: string; headers: Record<string, string> } }): Promise<unknown> {
  // `at`: where the model runs (the user's own server, when chosen for the whiteboard and allowed); else this PC
  const res = await fetch(`${opts.at?.base ?? OLLAMA_URL()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...opts.at?.headers },
    signal: AbortSignal.timeout(opts.timeoutMs),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: schema,
      keep_alive: "30m",
      options: { temperature: 0, num_predict: opts.maxTokens ?? 400 },
      messages: [{ role: "system", content: withLocalDate(system, new Date()) }, { role: "user", content: user, ...(opts.images?.length ? { images: opts.images } : {}) }],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const json = (await res.json()) as { message?: { content?: string } };
  return JSON.parse(json.message?.content ?? "null");
}

