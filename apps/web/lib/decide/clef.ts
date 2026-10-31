import { buildClefRequest, parseClefAnswers, type ClefResponse, type DecideRequest, type DecideResponse } from "@intelliprompter/core";

export const OLLAMA_URL = () => (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
export const CLEF_LOCAL_MODEL = () => process.env.CLEF_MODEL || "clef-flash";

/** Local decisions: Cloudflare Clef through Ollama's System One endpoint. Nothing leaves the machine. */
export async function decideClefLocal(body: DecideRequest): Promise<DecideResponse> {
  const model = CLEF_LOCAL_MODEL();
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL()}/v1/systemone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildClefRequest(body, model)),
    });
  } catch {
    throw new Error(`Ollama not reachable at ${OLLAMA_URL()}. Start Ollama (0.35.1+) and pull ${model} in Settings > Local models.`);
  }
  const latencyMs = Date.now() - started;
  if (res.status === 404) throw new Error(`Model ${model} not found in Ollama, or Ollama is older than 0.35.1. Pull it in Settings > Local models.`);
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const { decisions, unmentioned } = parseClefAnswers((await res.json()) as ClefResponse, body);
  return { decisions, unmentioned, latencyMs, cost: 0, model: `${model} (local)` };
}

/**
 * Hosted Clef on Cloudflare Workers AI. Uses the Workers AI run endpoint with the
 * same System One body. Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
 * Not verified live; the body shape follows the Ollama/System One contract.
 */
export async function decideClefCloudflare(body: DecideRequest): Promise<DecideResponse> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set.");
  const model = process.env.CLEF_CLOUDFLARE_MODEL || "@cf/cloudflare/clef-flash";
  const started = Date.now();
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...buildClefRequest(body, model), model: undefined }),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) throw new Error(`Workers AI ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { result?: ClefResponse } & ClefResponse;
  const { decisions, unmentioned } = parseClefAnswers(json.result ?? json, body);
  return { decisions, unmentioned, latencyMs, cost: null, model };
}
