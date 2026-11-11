// OK Filow answer providers. Local: the screen helper the setup for this computer chose
// (packages/core/src/profile.ts), in Ollama; nothing leaves the PC. Cloud: OpenRouter multimodal,
// only when the user picked it. An explicit choice never falls back to the other provider; errors
// go back to the bubble.
import { isSetupPreference, resolveSetup, type ResolvedSetup } from "@filow/core";
import { OLLAMA_URL } from "@/lib/decide/clef";
import { openRouterChatUrl, withProvider } from "@/lib/openrouter";
import { WHITEBOARD_MODELS, isWhiteboardModel } from "@/lib/whiteboard/models";
import { askRecipient, consentKey, freellmRecipient, type Recipient } from "./outbound";
import { freellmStream, requireFreeLlm } from "@/lib/freellm";
import { gpuInfo, machineInfo } from "@/lib/sysinfo";
import { buddySystemPrompt, trimHistory, type BuddyScreen, type BuddyTurn } from "./prompt";

export type BuddyProviderId = "local" | "cloud" | "freellm";

export type BuddyAskRequest = {
  question: string;
  /** JPEG data URLs, one per display, in screen order. */
  images: string[];
  screens: BuddyScreen[];
  history?: BuddyTurn[];
  language?: string;
  provider?: string;
  /** Consent key the caller holds for a cloud send ("ask:openrouter/google"); set from the request header. */
  consent?: string;
  /** the setup preference the user chose in Settings ("auto", "lite", ...); absent = "auto" */
  setup?: string;
};

/**
 * A caller with its own task (the whiteboard lesson, lib/whiteboard/generate.ts) gives its own system
 * prompt, a JSON schema for the answer and a length limit. Set by server code only, never read from
 * a request body. The consent lock and the provider choice in askBuddy apply unchanged.
 */
/** `model`: the cloud model for this call when it is not OK Filow's own (the whiteboard may name its own); consent is then asked for that model's maker. */
export type AskShape = { system: string; format?: unknown; maxTokens?: number; temperature?: number; model?: string };

/** What OK Filow runs on "Answers from: Local": the model, and whether it is shown the screenshot. */
export type LocalHelper = { model: string; pictures: boolean };

export const NO_LOCAL_HELPER =
  'This computer has too little memory for OK Filow to answer on this PC. To get answers from online instead, choose FreeLLMAPI or Cloud under "Answers from" in the OK Filow panel.';
export const OLLAMA_TOO_SLOW =
  'OK Filow got no answer on this PC within 3 minutes: the AI that runs it here is busy, often because the larger AI that checks your points is using the graphics card. Try again after the take, or choose FreeLLMAPI or Cloud under "Answers from" in the OK Filow panel.';
export const NO_LOCAL_HELPER_DISK =
  'There is not enough free disk space for OK Filow to answer on this PC (it needs about 6 GB free). Free some space, or choose FreeLLMAPI or Cloud under "Answers from" in the OK Filow panel to get answers from online.';

/** Drawings and 3D models: the 2B loops and writes broken JSON (measured), so a bigger picture model the user installed draws. */
export const BUDDY_DRAW_MODELS = ["qwen3-vl:8b", "qwen3-vl:4b", "gemma4:e4b"];
export const wantsVisual = (q: string) => /\b(draw|drawing|sketch|diagram|illustrat\w*|3d|model|disegn\w*|schema|modello)\b/i.test(q);

/**
 * The local model and mode for one question: the setup's screen helper (setupChoices), the same
 * model its downloads fetched, so OK Filow never asks Ollama for a model the setup did not install
 * nor answers from pictures where the setup chose text. On Best quality a drawing goes to a bigger
 * picture model when the user installed one. BUDDY_LOCAL_MODEL (developers) overrides all of it.
 */
export function localHelper(setup: Pick<ResolvedSetup, "active" | "choices">, installed: string[], question: string, configured = process.env.BUDDY_LOCAL_MODEL): LocalHelper {
  if (configured) return { model: configured, pictures: true };
  const h = setup.choices.screenHelper;
  if (h.mode === "none" || !h.model) throw new Error(h.lacking === "disk" ? NO_LOCAL_HELPER_DISK : NO_LOCAL_HELPER);
  if (h.mode === "picture" && setup.active === "advanced" && wantsVisual(question)) {
    const names = new Set(installed.flatMap((n) => [n, n.replace(/:latest$/, "")]));
    const big = BUDDY_DRAW_MODELS.find((m) => names.has(m));
    if (big) return { model: big, pictures: true };
  }
  return { model: h.model, pictures: h.mode === "picture" };
}

async function installedModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_URL()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    return (json.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/** The setup for this computer under the user's preference: the rule Settings and the downloads use. */
export async function serverSetup(preference?: unknown, installed?: string[]): Promise<ResolvedSetup> {
  return resolveSetup(isSetupPreference(preference) ? preference : "auto", machineInfo(await gpuInfo(), installed));
}

/** The local helper for a question under the user's setup preference (throws when none fits, saying why). */
export async function resolveLocalHelper(preference: unknown, question: string): Promise<LocalHelper> {
  const installed = process.env.BUDDY_LOCAL_MODEL ? [] : await installedModels();
  return localHelper(await serverSetup(preference, installed), installed, question);
}

/** Loads the setup's screen helper and keeps it loaded for 30 minutes (empty prompt: Ollama only loads). */
export async function warmLocalModel(preference?: unknown): Promise<{ model: string | null; ok: boolean }> {
  let model: string;
  try {
    model = (await resolveLocalHelper(preference, "")).model;
  } catch {
    return { model: null, ok: false };
  }
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

/**
 * Offline mode means local, except that an explicit FreeLLMAPI request stays FreeLLMAPI so it is
 * refused with a reason (askBuddy) instead of answered somewhere the user did not pick; otherwise
 * the request's choice, else BUDDY_PROVIDER, else local.
 */
export function resolveBuddyProvider(requested?: string): BuddyProviderId {
  if (requested === "freellm") return "freellm";
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

export async function* askOllama(req: BuddyAskRequest, signal?: AbortSignal, helper?: LocalHelper, shape?: AskShape): AsyncGenerator<string> {
  const { model, pictures } = helper ?? (await resolveLocalHelper(req.setup, req.question));
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
        options: { temperature: shape?.temperature ?? 0.3, num_ctx: 8192, num_predict: shape?.maxTokens ?? 1500 },
        // A JSON schema the answer must follow (Ollama structured output), when the caller has one.
        ...(shape?.format ? { format: shape.format } : {}),
        messages: [
          { role: "system", content: shape?.system ?? buddySystemPrompt(req.screens, req.language ?? "", { pictures }) },
          ...history,
          // Gemma reads images placed on the message before the text. Text mode sends no picture at all.
          { role: "user", content: req.question, images: pictures ? req.images.map(base64Of) : [] },
          ...noThinkPrefill(model),
        ],
      }),
    });
  } catch (e) {
    if (signal?.aborted) return;
    // the 3-minute limit: Ollama is there but busy (on a small graphics card the larger AI may hold it)
    if (e instanceof Error && e.name === "TimeoutError") throw new Error(OLLAMA_TOO_SLOW, { cause: e });
    // The desktop shell reads "is not running" (localai.js OLLAMA_STOPPED) and starts an installed Ollama in the background.
    throw new Error(`Ollama, which runs OK Filow's answers on this PC, is not running. If it is installed, Filow is starting it now: ask again in a minute. If not, install it in Settings > Local models, or set "Answers from" to FreeLLMAPI or Cloud in the OK Filow panel.`, { cause: e });
  }
  if (res.status === 404) throw new Error(`The screen helper for this computer's setup is not downloaded yet. Get it in Settings > Local models with "Download now", or set "Answers from" to FreeLLMAPI or Cloud in the OK Filow panel.`);
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

async function* askOpenRouter(req: BuddyAskRequest, signal?: AbortSignal, shape?: AskShape): AsyncGenerator<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("No OpenRouter key: add OPENROUTER_API_KEY, or switch the buddy to the local model.");
  const history = trimHistory(req.history ?? []).map((t) => ({ role: t.role, content: t.text }));
  const res = await fetch(openRouterChatUrl(), {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.PUBLIC_ORIGIN || "http://localhost:4747",
      "X-Title": "Filow",
    },
    body: JSON.stringify({
      model: shape?.model || BUDDY_CLOUD_MODEL(),
      stream: true,
      temperature: 0.3,
      // 500 cut a photosynthesis drawing off mid-JSON (953 chars); a spoken answer plus a drawing is about 500-900 tokens.
      max_tokens: shape?.maxTokens ?? 1500,
      ...(shape?.format ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: shape?.system ?? buddySystemPrompt(req.screens, req.language ?? "") },
        ...history,
        {
          role: "user",
          content: [{ type: "text", text: req.question }, ...req.images.map((url) => ({ type: "image_url", image_url: { url } }))],
        },
      ],
      // Only the company the notice named runs the model (lib/openrouter.ts, openRouterProvider).
      ...withProvider([shape?.model || BUDDY_CLOUD_MODEL()]),
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

/**
 * Through the user's FreeLLMAPI router: the same question, screenshots and conversation as the
 * cloud, to the model or `auto:*` strategy set in Settings. Its failures carry their own reason and
 * next step (lib/freellm.ts); there is never a fallback to another provider.
 */
async function* askFreeLlm(req: BuddyAskRequest, signal?: AbortSignal, shape?: AskShape): AsyncGenerator<string> {
  const history = trimHistory(req.history ?? []).map((t) => ({ role: t.role, content: t.text }));
  yield* freellmStream({
    temperature: 0.3,
    max_tokens: shape?.maxTokens ?? 1500,
    messages: [
      { role: "system", content: shape?.system ?? buddySystemPrompt(req.screens, req.language ?? "") },
      ...history,
      { role: "user", content: [{ type: "text", text: req.question }, ...req.images.map((url) => ({ type: "image_url", image_url: { url } }))] },
    ],
  }, signal);
}

/** The cloud was asked for without the user's yes for the recipient in use. Nothing was sent. */
export class ConsentRequiredError extends Error {
  constructor(readonly recipient: Recipient) {
    super(`consent_required: ask:${recipient.id}`);
    this.name = "ConsentRequiredError";
  }
}

/** Who a cloud question goes to right now: OpenRouter, then the maker of BUDDY_CLOUD_MODEL. */
export const buddyCloudRecipient = (): Recipient => askRecipient(BUDDY_CLOUD_MODEL());
/**
 * The online model of a whiteboard lesson: WHITEBOARD_CLOUD_MODEL when set (for a measured run),
 * else the one the user chose among WHITEBOARD_MODELS, else the default. A name that is not on the
 * list is never sent anywhere.
 */
export const WHITEBOARD_CLOUD_MODEL = (chosen?: unknown): string =>
  process.env.WHITEBOARD_CLOUD_MODEL || (isWhiteboardModel(chosen) ? chosen : WHITEBOARD_MODELS[0]);
/** Who receives a whiteboard question online: OpenRouter and the maker of that model (its own yes). */
export const whiteboardCloudRecipient = (chosen?: unknown): Recipient => askRecipient(WHITEBOARD_CLOUD_MODEL(chosen));

/**
 * The only door to a provider. Cloud needs the consent key for the recipient in use; without it this
 * throws before any network call (the panel asks first, this is the second lock).
 */
export function askBuddy(provider: BuddyProviderId, req: BuddyAskRequest, signal?: AbortSignal, helper?: LocalHelper, shape?: AskShape): AsyncGenerator<string> {
  if (provider === "freellm") {
    // offline, no key or an address outside the user's network: refused before the consent check
    requireFreeLlm();
    const recipient = freellmRecipient();
    if (req.consent !== consentKey("ask", recipient)) throw new ConsentRequiredError(recipient);
    return askFreeLlm(req, signal, shape);
  }
  if (provider !== "cloud") return askOllama(req, signal, helper, shape);
  // the yes must be for the maker of the model that is actually called
  const recipient = shape?.model ? askRecipient(shape.model) : buddyCloudRecipient();
  if (req.consent !== consentKey("ask", recipient)) throw new ConsentRequiredError(recipient);
  return askOpenRouter(req, signal, shape);
}
