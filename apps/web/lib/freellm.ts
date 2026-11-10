// FreeLLMAPI (github.com/tashfeenahmed/freellmapi, MIT): a router the user installs and runs on their
// own PC or another computer on their network. It serves an OpenAI-compatible API (default
// http://localhost:3001/v1, one "unified" key) and passes each request on to a free-tier AI provider
// it picks, with the user's own keys for those providers. The router is local; the provider is not,
// and it may keep or train on what it receives. So every send goes through the outbound notice and
// consent like OpenRouter (docs/okfilow/OUTBOUND.md), and Offline mode refuses it.
//
// Filow never installs or bundles FreeLLMAPI. Settings: FREELLMAPI_BASE_URL, FREELLMAPI_API_KEY (an
// encrypted secret in the desktop app, like the OpenRouter key), FREELLMAPI_MODEL ("auto" or an
// "auto:*" strategy, or one model id), SCRIPT_CLOUD=freellm (scripts are written and translated
// through it instead of OpenRouter).

export const FREELLM_DEFAULT_URL = "http://localhost:3001/v1";
export const FREELLM_DEFAULT_MODEL = "auto";
export const FREELLM_DOWNLOAD_URL = "https://github.com/tashfeenahmed/freellmapi/releases/latest";

/** The consent id, and the one name the notice, the signal and the list of choices show (lib/buddy/outbound.ts). */
export { FREELLM_ID, FREELLM_NAME, freellmRecipient } from "@/lib/buddy/outbound";

/** Why a FreeLLMAPI request did not get an answer. The message names the next step. */
export type FreeLlmCode = "offline" | "no_key" | "bad_url" | "not_running" | "bad_key" | "quota" | "no_vision" | "bad_model" | "failed";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Loopback or a private network address: the router runs on this PC or on the user's own network. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const m = IPV4.exec(h);
  if (m) {
    const [a, b, c, d] = m.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return false;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (h === "::1") return true;
  // IPv6 unique local (fc00::/7) and link-local (fe80::/10)
  return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
}

/**
 * The base URL the user typed, checked and tidied: http or https only, this PC or a LAN address,
 * no user name or password in it, no query. A bare "http://host:3001" gets "/v1". Null when refused.
 */
export function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (!isLocalHost(u.hostname)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${path || "/v1"}`;
}

/** "auto", an "auto:*" strategy or profile, or one model id as FreeLLMAPI lists it. */
export function normalizeModel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim();
  if (!m) return FREELLM_DEFAULT_MODEL;
  return /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/.test(m) ? m : null;
}

export type FreeLlmConfig = { baseUrl: string | null; key: string; model: string };

export function freellmConfig(): FreeLlmConfig {
  const rawUrl = process.env.FREELLMAPI_BASE_URL;
  return {
    baseUrl: normalizeBaseUrl(rawUrl && rawUrl.trim() ? rawUrl : FREELLM_DEFAULT_URL),
    key: (process.env.FREELLMAPI_API_KEY || "").trim(),
    model: normalizeModel(process.env.FREELLMAPI_MODEL) ?? FREELLM_DEFAULT_MODEL,
  };
}

/** True when the key and an allowed address are set (not whether the router is running). */
export const freellmConfigured = () => {
  const c = freellmConfig();
  return Boolean(c.baseUrl && c.key);
};

/** Scripts written and translated in the cloud go through FreeLLMAPI instead of OpenRouter. */
export const scriptCloud = (): "openrouter" | "freellm" => (process.env.SCRIPT_CLOUD === "freellm" ? "freellm" : "openrouter");

const EN: Record<FreeLlmCode, string> = {
  offline: "Offline mode is on, so nothing goes to FreeLLMAPI: it passes each request on to a provider on the internet. Switch Offline mode off, or choose This PC.",
  no_key: "FreeLLMAPI has no key yet. Copy the unified key from the Keys page of FreeLLMAPI into Settings > FreeLLMAPI, or choose another source.",
  bad_url: "The FreeLLMAPI address must start with http:// or https:// and point to this PC or a computer on your network, for example http://localhost:3001/v1. Fix it in Settings > FreeLLMAPI.",
  not_running: "FreeLLMAPI is not answering at {url}. Start the FreeLLMAPI app (or install it from its download page), or choose another source.",
  bad_key: "FreeLLMAPI refused the key. Copy the unified key again from the Keys page of FreeLLMAPI into Settings > FreeLLMAPI.",
  quota: "FreeLLMAPI has used up the free quotas of its providers for now. Try again later, add another provider key in FreeLLMAPI, or choose another source.",
  no_vision: "None of the models in your FreeLLMAPI can read pictures, and this needs a screenshot. Turn on a model with Vision (Gemini, for example) in FreeLLMAPI's Fallback Chain, or choose another source.",
  bad_model: "FreeLLMAPI does not know the model \"{model}\". Pick auto or a model it lists in Settings > FreeLLMAPI.",
  failed: "FreeLLMAPI could not answer ({detail}). Try again, or choose another source.",
};
const IT: Record<FreeLlmCode, string> = {
  offline: "La modalità offline è attiva, quindi nulla va a FreeLLMAPI: passa ogni richiesta a un fornitore su internet. Disattiva la modalità offline o scegli Questo PC.",
  no_key: "FreeLLMAPI non ha ancora una chiave. Copia la chiave unificata dalla pagina Keys di FreeLLMAPI in Impostazioni > FreeLLMAPI, oppure scegli un'altra fonte.",
  bad_url: "L'indirizzo di FreeLLMAPI deve iniziare con http:// o https:// e puntare a questo PC o a un computer della tua rete, per esempio http://localhost:3001/v1. Correggilo in Impostazioni > FreeLLMAPI.",
  not_running: "FreeLLMAPI non risponde a {url}. Avvia l'app FreeLLMAPI (o installala dalla sua pagina di download), oppure scegli un'altra fonte.",
  bad_key: "FreeLLMAPI ha rifiutato la chiave. Copia di nuovo la chiave unificata dalla pagina Keys di FreeLLMAPI in Impostazioni > FreeLLMAPI.",
  quota: "FreeLLMAPI ha finito per ora le quote gratuite dei suoi fornitori. Riprova più tardi, aggiungi un'altra chiave di un fornitore in FreeLLMAPI, oppure scegli un'altra fonte.",
  no_vision: "Nessuno dei modelli del tuo FreeLLMAPI sa leggere le immagini, e qui serve uno screenshot. Attiva un modello con Vision (per esempio Gemini) nella Fallback Chain di FreeLLMAPI, oppure scegli un'altra fonte.",
  bad_model: "FreeLLMAPI non conosce il modello \"{model}\". Scegli auto o un modello del suo elenco in Impostazioni > FreeLLMAPI.",
  failed: "FreeLLMAPI non è riuscito a rispondere ({detail}). Riprova, oppure scegli un'altra fonte.",
};

/** The sentence for a code, in English or Italian, with {url}, {model} and {detail} filled in. */
export function freellmMessage(code: FreeLlmCode, lang: string, vars: { url?: string; model?: string; detail?: string } = {}): string {
  const text = (lang === "it" ? IT : EN)[code];
  return text.replace("{url}", vars.url ?? FREELLM_DEFAULT_URL).replace("{model}", vars.model ?? "").replace("{detail}", vars.detail ?? "");
}

const TAG = /^\s*\[freellm:([a-z_]+)\]\s*/;

/**
 * A FreeLLMAPI failure. The message starts with a tag ("[freellm:quota] ...") so a client can show
 * the sentence in the user's language (`localizeFreeLlmError`); the English text follows the tag.
 */
export class FreeLlmError extends Error {
  constructor(readonly code: FreeLlmCode, vars: { url?: string; model?: string; detail?: string } = {}) {
    super(`[freellm:${code}] ${freellmMessage(code, "en", vars)}`);
    this.name = "FreeLlmError";
  }
}

/** A tagged error text in the user's language; any other text comes back as it is. */
export function localizeFreeLlmError(text: string, lang: string, vars: { url?: string; model?: string } = {}): string {
  const m = TAG.exec(text);
  if (!m) return text;
  const code = m[1] as FreeLlmCode;
  if (!(code in EN)) return text.replace(TAG, "");
  if (lang !== "it") return text.replace(TAG, "");
  // the English detail of a "failed" stays as the reason inside the Italian sentence
  const detail = code === "failed" ? /\((.*)\)/.exec(text)?.[1] : undefined;
  const url = code === "not_running" ? / at (\S+?)\. /.exec(text)?.[1] : undefined;
  const model = code === "bad_model" ? /model "(.*?)"/.exec(text)?.[1] : undefined;
  return freellmMessage(code, "it", { url: url ?? vars.url, model: model ?? vars.model, detail });
}
export const freellmCodeOf = (text: string): FreeLlmCode | null => {
  const m = TAG.exec(text);
  return m && m[1] in EN ? (m[1] as FreeLlmCode) : null;
};

/** Checks offline mode, the address and the key before anything is sent. */
export function requireFreeLlm(): { baseUrl: string; key: string; model: string } {
  if (process.env.FILOW_OFFLINE === "1") throw new FreeLlmError("offline");
  const c = freellmConfig();
  if (!c.baseUrl) throw new FreeLlmError("bad_url");
  if (!c.key) throw new FreeLlmError("no_key");
  return { baseUrl: c.baseUrl, key: c.key, model: c.model };
}

/** `error.code` and `error.message` of an OpenAI-style error body; the raw text when it is not JSON. */
function replyBody(text: string): { code: string; message: string } {
  try {
    const j = JSON.parse(text) as { error?: { code?: unknown; message?: unknown; type?: unknown } | string };
    const e = typeof j.error === "object" && j.error ? j.error : {};
    return { code: String(e.code ?? e.type ?? ""), message: String(e.message ?? (typeof j.error === "string" ? j.error : "")) };
  } catch {
    return { code: "", message: text };
  }
}

/** The error a non-2xx reply means, from its status and FreeLLMAPI's OpenAI-style `error.code`. */
export async function freellmReplyError(res: Response, ctx: { model: string }): Promise<FreeLlmError> {
  const { code, message } = replyBody(await res.text().catch(() => ""));
  if (res.status === 401 || res.status === 403) return new FreeLlmError("bad_key");
  if (res.status === 429 || /quota|exhausted|rate.?limit/i.test(code)) return new FreeLlmError("quota");
  if (code === "no_vision_model" || (res.status === 422 && /vision/i.test(message))) return new FreeLlmError("no_vision");
  if ((res.status === 400 || res.status === 404) && /model|profile/i.test(`${code} ${message}`)) return new FreeLlmError("bad_model", { model: ctx.model });
  // 502/503: every provider in the chain failed; usually quotas or providers down
  if (res.status === 502 || res.status === 503) return new FreeLlmError("quota");
  const short = message.replace(/\s+/g, " ").trim().slice(0, 160);
  return new FreeLlmError("failed", { detail: `${res.status}${short ? `: ${short}` : ""}` });
}

/**
 * fetch to the router. A refused connection is "not running"; no reply within `ms` is "not running"
 * for the quick connection check and a plain failure for a chat (the router may be slow, not gone).
 */
async function routerFetch(url: string, init: RequestInit, baseUrl: string, ms: number, slowIsDown = false): Promise<Response> {
  const timeout = AbortSignal.timeout(ms);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    if (timeout.aborted && !slowIsDown) throw new FreeLlmError("failed", { detail: `no answer within ${Math.round(ms / 1000)} s` });
    throw new FreeLlmError("not_running", { url: baseUrl.replace(/\/v1$/, "") });
  }
}

const headers = (key: string) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

export type FreeLlmResult = { content: string; model: string };

/** One chat completion, answered as a whole. `payload` holds messages, temperature, max_tokens. */
export async function freellmChat(payload: Record<string, unknown>, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<FreeLlmResult> {
  const { baseUrl, key, model } = requireFreeLlm();
  const res = await routerFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: opts.signal,
    headers: headers(key),
    body: JSON.stringify({ ...payload, model, stream: false }),
  }, baseUrl, opts.timeoutMs ?? 120_000);
  if (!res.ok) throw await freellmReplyError(res, { model });
  const json = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; model?: string };
  return { content: json.choices?.[0]?.message?.content ?? "", model: freellmModelLabel(res, json.model ?? model) };
}

/** "FreeLLMAPI: groq/llama-3.3-70b" from X-Routed-Via when the router says which provider answered. */
function freellmModelLabel(res: Response, model: string): string {
  const via = res.headers.get("x-routed-via") ?? "";
  const routed = (() => {
    try {
      return decodeURIComponent(via);
    } catch {
      return via;
    }
  })();
  return `FreeLLMAPI: ${(routed || model).slice(0, 120)}`;
}

/** Streams the answer's text pieces (OpenAI server-sent events). */
export async function* freellmStream(payload: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<string> {
  const { baseUrl, key, model } = requireFreeLlm();
  // 3 minutes like a local answer: the router may try several providers before one answers.
  const res = await routerFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: headers(key),
    body: JSON.stringify({ ...payload, model, stream: true }),
  }, baseUrl, 180_000);
  if (!res.ok || !res.body) throw await freellmReplyError(res, { model });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new FreeLlmError("failed", { detail: "the answer stopped halfway" });
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      let json: { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string; code?: string } };
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) {
        const code = String(json.error.code ?? "");
        if (/quota|exhausted|rate.?limit/i.test(code)) throw new FreeLlmError("quota");
        if (code === "no_vision_model") throw new FreeLlmError("no_vision");
        throw new FreeLlmError("failed", { detail: String(json.error.message ?? "error").slice(0, 160) });
      }
      const piece = json.choices?.[0]?.delta?.content;
      if (piece) yield piece;
    }
  }
}

export type FreeLlmCheck =
  | { ok: true; models: string[]; ready: number; url: string }
  | { ok: false; code: FreeLlmCode; error: string; url: string | null };

/**
 * "Check connection": GET /v1/models with the key. Sends no user content (the request itself only).
 * Lists the routing entries (auto, auto:*) and the models FreeLLMAPI says are ready now.
 */
export async function checkFreeLlm(lang = "en"): Promise<FreeLlmCheck> {
  const c = freellmConfig();
  const url = c.baseUrl;
  try {
    const { baseUrl, key, model } = requireFreeLlm();
    const res = await routerFetch(`${baseUrl}/models`, { headers: headers(key) }, baseUrl, 5000, true);
    if (!res.ok) throw await freellmReplyError(res, { model });
    const json = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: unknown; execution_status?: unknown }> };
    const rows = Array.isArray(json.data) ? json.data : [];
    const ids = rows.map((r) => (typeof r.id === "string" ? r.id : "")).filter((id) => id && normalizeModel(id) === id);
    const ready = rows.filter((r) => r.execution_status === undefined || r.execution_status === "ready").length;
    const routing = ids.filter((id) => id === "auto" || id.startsWith("auto:"));
    const readyIds = rows.filter((r) => typeof r.id === "string" && r.execution_status === "ready").map((r) => r.id as string);
    const models = [...new Set([...routing, ...readyIds, ...ids])].slice(0, 60);
    return { ok: true, models, ready, url: baseUrl };
  } catch (e) {
    if (e instanceof FreeLlmError) return { ok: false, code: e.code, error: localizeFreeLlmError(e.message, lang), url };
    return { ok: false, code: "failed", error: freellmMessage("failed", lang, { detail: e instanceof Error ? e.message : String(e) }), url };
  }
}
