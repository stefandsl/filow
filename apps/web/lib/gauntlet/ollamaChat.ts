import { SYSTEM_PROMPT, buildUserPrompt, parseDecisions, type DecideRequest, type DecideResponse } from "@filow/core";
import { OLLAMA_URL } from "@/lib/decide/clef";

// Measurement only (gauntlet runner), not used by the app: a small Ollama chat model answering the
// decision prompt. Measured for the P3 setup profiles (docs/gauntlet/BASELINE.md): lfm3-vl 1.7B makes
// 15 false completions on the five corpora (4 behind the gate) at ~0.4 s per call on the GPU and
// 6 to 14 s per call on the CPU, so no profile uses it; the on-device matcher replaced it.

/** The small models the runner may load. */
export const SMALL_DECISION_MODELS = ["lfm3-vl"] as const;
export type SmallDecisionModel = (typeof SMALL_DECISION_MODELS)[number];

export function isSmallDecisionModel(name: unknown): name is SmallDecisionModel {
  return typeof name === "string" && (SMALL_DECISION_MODELS as readonly string[]).includes(name);
}

/**
 * Local decisions through a small Ollama chat model answering the same JSON as the cloud path.
 * `options` lets the gauntlet pin it to the CPU (num_gpu 0) to measure a machine without a GPU.
 */
export async function decideOllamaChat(body: DecideRequest, model: SmallDecisionModel, signal?: AbortSignal, options: Record<string, number> = {}): Promise<DecideResponse> {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        format: "json",
        keep_alive: -1,
        // about 25 tokens per point; 4 points at most per call (engine maxQuestions)
        options: { temperature: 0, num_ctx: 2048, num_predict: 160, ...options },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(body) },
        ],
      }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new Error(`Ollama not reachable at ${OLLAMA_URL()}. Start Ollama and get ${model} in Settings > Local models.`, { cause: err });
  }
  if (res.status === 404) throw new Error(`Model ${model} not found in Ollama. Get it in Settings > Local models.`);
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { message?: { content?: string } };
  const { decisions, unmentioned } = parseDecisions(json.message?.content ?? "", body.bullets.map((b) => b.id));
  return { decisions, unmentioned, latencyMs: Date.now() - started, cost: 0, model: `${model} (local)` };
}
