// What leaves this PC, to whom, and whether the user said yes. Pure: shared by the panel, the take
// page and the API routes. The inventory of every outbound path is docs/okfilow/OUTBOUND.md.
//
// Consent is kept per kind of content and per recipient ("ask:openrouter/google"). The recipient is
// derived from the provider and the model actually in use, so switching the cloud model to another
// maker asks again.

/** ask: question + screenshots. voice: answer text. audio: microphone. photo: a card's subject name.
 *  agent: task + last answer, through a coding CLI. transcript: spoken words, for take decisions.
 *  screen: pictures of the shared screen during a take. script: script text and slide pictures,
 *  for writing or translating a script. */
export type OutboundKind = "ask" | "voice" | "audio" | "photo" | "agent" | "transcript" | "screen" | "script";
export const OUTBOUND_KINDS: OutboundKind[] = ["ask", "voice", "audio", "photo", "agent", "transcript", "screen", "script"];
/**
 * names: who receives it, in order (the router first, then the maker of the model).
 * picked: OpenRouter chooses the company that runs the model, which may not be its maker
 * (`MAKER_HOSTS` has no host of the maker's own for it), so the notice must say so.
 */
export type Recipient = { id: string; names: string[]; picked?: true };
export type ConsentState = "granted" | "declined";
export type ConsentEntry = { state: ConsentState; at: string; names: string[] };
export type ConsentMap = Record<string, ConsentEntry>;
export type OutboundItem = { kind: OutboundKind; recipient: Recipient };
/** Main -> panel and overlays: what is in flight right now. */
export type OutboundSnapshot = { active: boolean; kinds: OutboundKind[]; names: string[] };

/** Request header carrying the consent key the client holds for this send. */
export const CONSENT_HEADER = "x-filow-consent";

/**
 * A send shorter than this still shows the signal this long, so it can be seen and read. The OK Filow
 * windows' copy is apps/desktop/okfilow-outbound.js MIN_SIGNAL_MS (CommonJS; a test keeps them equal).
 */
export const MIN_SIGNAL_MS = 1200;

const VENDORS: Record<string, string> = {
  google: "Google",
  openai: "OpenAI",
  anthropic: "Anthropic",
  "meta-llama": "Meta",
  meta: "Meta",
  mistralai: "Mistral AI",
  "x-ai": "xAI",
  qwen: "Alibaba",
  deepseek: "DeepSeek",
  microsoft: "Microsoft",
  amazon: "Amazon",
  nvidia: "NVIDIA",
  cohere: "Cohere",
  perplexity: "Perplexity",
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);

/** The company behind an OpenRouter model id prefix. Unknown makers keep their own name. */
export function vendorName(vendor: string): string {
  const key = slug(vendor);
  if (VENDORS[key]) return VENDORS[key];
  return key.split(/[-_.]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/**
 * The makers that run their own models on OpenRouter, as OpenRouter provider slugs
 * (openrouter.ai/docs, "Provider Routing"). A request for one of their models is pinned to these
 * hosts (`provider.only`, no fallbacks, see `openRouterProvider` in lib/openrouter.ts), so the
 * maker named in the notice is the company that runs it. Only makers whose models are hosted by the
 * maker itself are listed; their open-weight families, which other companies run, are excluded below.
 */
export const MAKER_HOSTS: Record<string, string[]> = {
  google: ["google-vertex", "google-ai-studio"],
  openai: ["openai"],
  anthropic: ["anthropic"],
};
/** Open-weight models of a listed maker: run by other companies, never by the maker on OpenRouter. */
const OPEN_WEIGHT = [/^google\/gemma/i, /^openai\/gpt-oss/i];

const makerOf = (model: string) => {
  const at = model.indexOf("/");
  return at > 0 ? slug(model.slice(0, at)) : "";
};

/** The maker's own OpenRouter hosts for this model, or null when OpenRouter picks who runs it. */
export function makerHosts(model: string): string[] | null {
  const hosts = MAKER_HOSTS[makerOf(model)];
  if (!hosts || OPEN_WEIGHT.some((re) => re.test(model.trim()))) return null;
  return hosts;
}

/**
 * OpenRouter passes the request on to the company that runs the model: the maker itself when the
 * request is pinned to the maker's hosts, otherwise one OpenRouter picks (then the id says so, and a
 * yes for a pinned model of the same maker does not cover it).
 */
export function askRecipient(model: string): Recipient {
  const vendor = makerOf(model);
  if (!vendor) return { id: "openrouter", names: ["OpenRouter"] };
  if (!makerHosts(model)) return { id: `openrouter/${vendor}@any`, names: ["OpenRouter", vendorName(vendor)], picked: true };
  return { id: `openrouter/${vendor}`, names: ["OpenRouter", vendorName(vendor)] };
}
/** True when two OpenRouter model ids come from the same maker: a yes for one covers the other. */
export const sameMaker = (a: string, b: string) => makerOf(a) !== "" && makerOf(a) === makerOf(b);

/**
 * A feature that may use more than one OpenRouter model (text and vision): every maker is named.
 * One maker gives the same recipient as `askRecipient`, so the wording and the stored key match.
 */
export function routerRecipient(models: string[]): Recipient {
  const makers = [...new Set(models.map(makerOf).filter(Boolean))].sort();
  if (makers.length === 0) return { id: "openrouter", names: ["OpenRouter"] };
  const names = ["OpenRouter", ...makers.map(vendorName)];
  if (models.some((m) => makerOf(m) && !makerHosts(m))) return { id: `openrouter/${makers.join("+")}@any`, names, picked: true };
  return { id: `openrouter/${makers.join("+")}`, names };
}
/**
 * FreeLLMAPI (lib/freellm.ts): the user's own router passes the content on to a free-tier provider it
 * picks per request, which Filow cannot know in advance. One recipient, one yes, whatever model or
 * strategy is set. The name is the English form; the windows show it in the user's language (`localNames`).
 */
export const FREELLM_ID = "freellmapi";
export const FREELLM_NAME = "FreeLLMAPI (a free provider it chooses)";
export const freellmRecipient = (): Recipient => ({ id: FREELLM_ID, names: [FREELLM_NAME] });
/** Names as a window shows them: FreeLLMAPI's in the window's language (`freeName`). */
export const localNames = (names: string[], freeName: string): string[] => names.map((n) => (n === FREELLM_NAME ? freeName : n));
export const voiceRecipient = (): Recipient => ({ id: "elevenlabs", names: ["ElevenLabs"] });
export const photoRecipient = (): Recipient => ({ id: "wikipedia", names: ["Wikipedia"] });

/** Who hears the microphone for a speech engine; null when the engine runs on this PC. */
export function sttRecipient(backend: string, userAgent = ""): Recipient | null {
  if (backend === "elevenlabs") return { id: "elevenlabs", names: ["ElevenLabs"] };
  if (backend === "openai") return { id: "openai", names: ["OpenAI"] };
  if (backend !== "browser") return null;
  // Web Speech sends audio to the browser maker's servers.
  if (/\bEdg\//.test(userAgent)) return { id: "browser/microsoft", names: ["Microsoft"] };
  if (/\bChrome\//.test(userAgent)) return { id: "browser/google", names: ["Google"] };
  // Safari, and Apple's web view (Office for Mac), which has no "Safari/" token.
  if (/\bSafari\//.test(userAgent) || (/AppleWebKit\//.test(userAgent) && /Mac OS X|iPhone|iPad/.test(userAgent))) return { id: "browser/apple", names: ["Apple"] };
  return { id: "browser", names: ["Web Speech"] };
}

export type DecisionModels = { openrouter: string; cloudflare: string };
/** Who reads the spoken words to decide when to scroll; null for the local decider. */
export function decisionRecipient(provider: string, models: DecisionModels): Recipient | null {
  if (provider === "openrouter") return askRecipient(models.openrouter);
  if (provider === "freellm") return freellmRecipient();
  if (provider === "clef-cloudflare") return { id: "cloudflare", names: ["Cloudflare"] };
  return null;
}

/** Everything a take sends out, from the engines picked for it. Empty when both are local. */
export function takeOutbound(o: { backend: string; provider: string; models: DecisionModels; userAgent?: string }): OutboundItem[] {
  const items: OutboundItem[] = [];
  const stt = sttRecipient(o.backend, o.userAgent);
  if (stt) items.push({ kind: "audio", recipient: stt });
  const decide = decisionRecipient(o.provider, o.models);
  if (decide) items.push({ kind: "transcript", recipient: decide });
  return items;
}

/**
 * Who the signal names while something is in flight: everyone the content goes to. When OpenRouter
 * picks the company that runs the model, only OpenRouter is known for sure, so only OpenRouter is
 * named (the notice and the list of choices say that OpenRouter picks the host).
 */
export const signalNames = (recipient: Recipient): string[] => (recipient.picked ? recipient.names.slice(0, 1) : recipient.names);

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[], and: string): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

/**
 * "OpenRouter and then to Google, the maker of the model you chose", or just the one name. When
 * OpenRouter picks the company that runs the model (`picked`), `pickedTemplate` says so, naming
 * every maker: a notice must never present the maker as the receiver when it may not be.
 */
export function whoPhrase(recipient: Recipient, viaTemplate: string, and: string, pickedTemplate: string): string {
  const [a, b] = recipient.names;
  if (recipient.picked && a && b) return pickedTemplate.split("{a}").join(a).split("{b}").join(joinNames(recipient.names.slice(1), and));
  // Exactly a router and one maker; with more makers every name is listed, none is dropped.
  if (recipient.id.startsWith("openrouter/") && recipient.names.length === 2 && a && b) return viaTemplate.replace("{a}", a).replace("{b}", b);
  return joinNames(recipient.names, and);
}

export const consentKey = (kind: OutboundKind, recipient: Recipient) => `${kind}:${recipient.id}`;

export function isGranted(consent: ConsentMap | undefined | null, kind: OutboundKind, recipient: Recipient): boolean {
  const entry = consent?.[consentKey(kind, recipient)];
  return typeof entry === "object" && entry !== null && entry.state === "granted";
}

export function withConsent(consent: ConsentMap | undefined | null, kind: OutboundKind, recipient: Recipient, state: ConsentState, at = new Date().toISOString()): ConsentMap {
  return { ...(consent ?? {}), [consentKey(kind, recipient)]: { state, at, names: recipient.names.slice(0, 3) } };
}

export function withoutConsent(consent: ConsentMap | undefined | null, key: string): ConsentMap {
  const next = { ...(consent ?? {}) };
  delete next[key];
  return next;
}

/**
 * One window's change to the stored choices, as a list of keys (null removes the key). Windows send
 * this, never their whole copy: a copy read before another window withdrew a yes would bring it back.
 */
export type ConsentChanges = Record<string, ConsentEntry | null>;
export function consentChanges(prev: ConsentMap | undefined | null, next: ConsentMap): ConsentChanges {
  const out: ConsentChanges = {};
  const before = prev ?? {};
  for (const [k, v] of Object.entries(next)) if (JSON.stringify(before[k]) !== JSON.stringify(v)) out[k] = v;
  for (const k of Object.keys(before)) if (!(k in next)) out[k] = null;
  return out;
}
export function applyConsentChanges(base: ConsentMap | undefined | null, changes: ConsentChanges): ConsentMap {
  const out: ConsentMap = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** True when every change is in the stored map: a yes that was not stored is not a yes. */
export const changesStored = (stored: ConsentMap, changes: ConsentChanges) =>
  Object.entries(changes).every(([k, v]) => (v === null ? !(k in stored) : stored[k]?.state === v.state));

/** granted: send. declined: keep it on this PC (remembered). dismissed: closed without choosing. */
export type Decision = "granted" | "declined" | "dismissed";
export type GateResult<T> = { sent: true; decision: "granted"; value: T } | { sent: false; decision: "declined" | "dismissed" };

/**
 * The one way out: `send` runs only after a yes for exactly this kind and this recipient.
 * Anything else (a no, a closed notice, a yes given for another recipient) sends nothing.
 */
export async function gateOutbound<T>(o: {
  kind: OutboundKind;
  recipient: Recipient;
  consent: ConsentMap | undefined | null;
  ask: () => Promise<Decision>;
  send: () => Promise<T>;
}): Promise<GateResult<T>> {
  const decision = isGranted(o.consent, o.kind, o.recipient) ? "granted" : await o.ask();
  if (decision !== "granted") return { sent: false, decision };
  return { sent: true, decision, value: await o.send() };
}

/** What GET /api/buddy/recipients answers: who would receive what, from the configured providers and models. */
export type BuddyRecipients = {
  offline: boolean;
  /** Who a cloud question goes to, from the cloud model configured on this PC right now. */
  ask: Recipient;
  /** Who a question answered through FreeLLMAPI goes to. Absent on an older server. */
  freellm?: Recipient;
  voice: Recipient;
  photo: Recipient;
  /** Models behind the take page's cloud deciders; the page names their makers from these. */
  decision: DecisionModels;
  /** Who reads pictures of the shared screen during a take (Screen Sense). */
  screen: Recipient;
  /** Who reads the script and the slide pictures when a script is written or translated in the cloud. */
  script: Recipient;
  /**
   * What the server runs when the client does not choose (the PowerPoint add-in and the browser
   * extension do not): the decision provider and the script writer. Absent on an older server.
   */
  defaults?: { decide: string; generate: string };
};

/**
 * What to do before a send. granted: go. declined: keep it on this PC without asking again.
 * ask: show the notice first.
 *
 * Only an optional extra (a card's picture) stays declined silently. For the others a "no" also
 * switches the feature to this PC, so finding the cloud selected again means the user chose it
 * again: they get the notice again instead of a send or a silent refusal.
 */
export function standing(consent: ConsentMap | undefined | null, kind: OutboundKind, recipient: Recipient): "granted" | "declined" | "ask" {
  if (isGranted(consent, kind, recipient)) return "granted";
  if (kind === "photo" && consent?.[consentKey(kind, recipient)]?.state === "declined") return "declined";
  return "ask";
}

/** "Keep it on this PC" also moves the feature to this PC, so the next question does not ask again. */
export type KeepLocalPatch = { provider?: "local"; voice?: "system" };
export function keepLocalPatch(kind: OutboundKind): KeepLocalPatch {
  if (kind === "ask") return { provider: "local" };
  if (kind === "voice") return { voice: "system" };
  return {};
}

/**
 * THE one place that says whether a screen-helper question stays on this PC or goes out: to the
 * cloud (OpenRouter) or through the user's FreeLLMAPI router. Anything that is not an explicit
 * "cloud" or "freellm" on an online PC is local. (When the per-machine setup decides the
 * screen-helper mode, point this function at that value and nothing else changes.)
 */
export type AskRoute = "local" | "cloud" | "freellm";
export function askRoute(status: { provider?: string; offline?: boolean } | null | undefined): AskRoute {
  if (!status || status.offline) return "local";
  return status.provider === "cloud" || status.provider === "freellm" ? status.provider : "local";
}
/** Who the route sends a question to; null when it stays on this PC. */
export function askRouteRecipient(route: AskRoute, rec: Pick<BuddyRecipients, "ask" | "freellm">): Recipient | null {
  if (route === "cloud") return rec.ask;
  if (route === "freellm") return rec.freellm ?? freellmRecipient();
  return null;
}
/** The same decision for the voice that reads the answers. */
export function voiceRoute(status: { voice?: string; offline?: boolean } | null | undefined): "local" | "cloud" {
  return status?.voice === "cloud" && !status.offline ? "cloud" : "local";
}

/** One first-send notice: what would go, to whom (and through which CLI, for agents). */
/** `words`: a question that goes without a screenshot ("Look at my screen" is off): the notice says so. */
export type NoticeRequest = { kind: OutboundKind; recipient: Recipient; cli?: string; words?: true };

type NoticeTextKey = `notice_${OutboundKind}` | "notice_askWords" | "outVia" | "outViaPicked" | "outAnd" | "outFree" | "outFreeWarn";
/**
 * What the notice says: what goes, and to whom, from the recipient actually in use. Through
 * FreeLLMAPI it also says that the provider it picks is not known in advance and may keep or train
 * on the content.
 */
export function noticeBody(notice: NoticeRequest, t: (key: NoticeTextKey) => string): string {
  const free = notice.recipient.id === FREELLM_ID;
  const who = free ? t("outFree") : whoPhrase(notice.recipient, t("outVia"), t("outAnd"), t("outViaPicked"));
  // A sentence may name the recipient or the CLI more than once: every place is filled.
  // The notice names only what really goes: no screenshot when the question goes with words only.
  const body = t(notice.kind === "ask" && notice.words ? "notice_askWords" : `notice_${notice.kind}`).split("{who}").join(who).split("{cli}").join(notice.cli ?? "");
  return free ? `${body} ${t("outFreeWarn")}` : body;
}

/**
 * Notices wait in line: one is shown at a time, and two sends that need the same yes share one
 * notice and one answer. Nothing resolves "granted" unless `settle("granted")` is called for it.
 */
export function createNoticeQueue(onChange: (head: NoticeRequest | null) => void) {
  const waiting: Array<{ key: string; notice: NoticeRequest; promise: Promise<Decision>; resolve: (d: Decision) => void }> = [];
  const head = () => waiting[0]?.notice ?? null;
  return {
    head,
    ask(notice: NoticeRequest): Promise<Decision> {
      const key = consentKey(notice.kind, notice.recipient);
      const same = waiting.find((w) => w.key === key);
      if (same) return same.promise;
      let resolve: (d: Decision) => void = () => {};
      const promise = new Promise<Decision>((r) => { resolve = r; });
      waiting.push({ key, notice, promise, resolve });
      if (waiting.length === 1) onChange(head());
      return promise;
    },
    /** Answers the notice on screen and shows the next one. */
    settle(decision: Decision) {
      const first = waiting.shift();
      if (!first) return;
      first.resolve(decision);
      onChange(head());
    },
    /** The question was dropped (new question, panel closed): nothing waiting may be sent. */
    dismissAll() {
      if (!waiting.length) return;
      for (const w of waiting.splice(0)) w.resolve("dismissed");
      onChange(null);
    },
  };
}

/**
 * Server side: 403 unless the request carries the consent key for this kind and this recipient.
 * `code` is for programs; `error` is the sentence a client without its own notice (the PowerPoint
 * add-in, the browser extension) shows as it is, so the user learns why nothing happened.
 */
export function consentDenied(req: Request, kind: OutboundKind, recipient: Recipient): Response | null {
  if (req.headers.get(CONSENT_HEADER) === consentKey(kind, recipient)) return null;
  const who = whoPhrase(recipient, "{a} and {b}", "and","{a} and then to a company it picks to run the model by {b}");
  const error = `Not sent: this would go to ${who}, and you have not said yes to that here. Use Local mode, or allow it in the Filow window that asks.`;
  return Response.json({ error, code: "consent_required", kind, recipient }, { status: 403 });
}
