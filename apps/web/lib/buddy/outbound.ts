// What leaves this PC, to whom, and whether the user said yes. Pure: shared by the panel, the take
// page and the API routes. The inventory of every outbound path is docs/okfilow/OUTBOUND.md.
//
// Consent is kept per kind of content and per recipient ("ask:openrouter/google"). The recipient is
// derived from the provider and the model actually in use, so switching the cloud model to another
// maker asks again.

/** ask: question + screenshots. voice: answer text. audio: microphone. photo: a card's subject name.
 *  agent: task + last answer, through a coding CLI. transcript: spoken words, for take decisions. */
export type OutboundKind = "ask" | "voice" | "audio" | "photo" | "agent" | "transcript";
export const OUTBOUND_KINDS: OutboundKind[] = ["ask", "voice", "audio", "photo", "agent", "transcript"];
/** names: who receives it, in order (the router first, then the maker of the model). */
export type Recipient = { id: string; names: string[] };
export type ConsentState = "granted" | "declined";
export type ConsentEntry = { state: ConsentState; at: string; names: string[] };
export type ConsentMap = Record<string, ConsentEntry>;
export type OutboundItem = { kind: OutboundKind; recipient: Recipient };
/** Main -> panel and overlays: what is in flight right now. */
export type OutboundSnapshot = { active: boolean; kinds: OutboundKind[]; names: string[] };

/** Request header carrying the consent key the client holds for this send. */
export const CONSENT_HEADER = "x-filow-consent";

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

/** OpenRouter passes the request on to the maker of the model: both are recipients. */
export function askRecipient(model: string): Recipient {
  const at = model.indexOf("/");
  const vendor = at > 0 ? slug(model.slice(0, at)) : "";
  if (!vendor) return { id: "openrouter", names: ["OpenRouter"] };
  return { id: `openrouter/${vendor}`, names: ["OpenRouter", vendorName(vendor)] };
}
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
  if (/\bSafari\//.test(userAgent)) return { id: "browser/apple", names: ["Apple"] };
  return { id: "browser", names: ["Web Speech"] };
}

export type DecisionModels = { openrouter: string; cloudflare: string };
/** Who reads the spoken words to decide when to scroll; null for the local decider. */
export function decisionRecipient(provider: string, models: DecisionModels): Recipient | null {
  if (provider === "openrouter") return askRecipient(models.openrouter);
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

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[], and: string): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

/** "OpenRouter and then to Google, the maker of the model you chose", or just the one name. */
export function whoPhrase(recipient: Recipient, viaTemplate: string, and: string): string {
  const [a, b] = recipient.names;
  if (recipient.id.startsWith("openrouter/") && a && b) return viaTemplate.replace("{a}", a).replace("{b}", b);
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
  voice: Recipient;
  photo: Recipient;
  /** Models behind the take page's cloud deciders; the page names their makers from these. */
  decision: DecisionModels;
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
 * THE one place that says whether a screen-helper question stays on this PC or goes to the cloud.
 * Anything that is not an explicit "cloud" on an online PC is local. (When the per-machine setup
 * decides the screen-helper mode, point this function at that value and nothing else changes.)
 */
export function askRoute(status: { provider?: string; offline?: boolean } | null | undefined): "local" | "cloud" {
  return status?.provider === "cloud" && !status.offline ? "cloud" : "local";
}
/** The same decision for the voice that reads the answers. */
export function voiceRoute(status: { voice?: string; offline?: boolean } | null | undefined): "local" | "cloud" {
  return status?.voice === "cloud" && !status.offline ? "cloud" : "local";
}

/** One first-send notice: what would go, to whom (and through which CLI, for agents). */
export type NoticeRequest = { kind: OutboundKind; recipient: Recipient; cli?: string };

type NoticeTextKey = `notice_${OutboundKind}` | "outVia" | "outAnd";
/** What the notice says: what goes, and to whom, from the recipient actually in use. */
export function noticeBody(notice: NoticeRequest, t: (key: NoticeTextKey) => string): string {
  return t(`notice_${notice.kind}`)
    .replace("{who}", whoPhrase(notice.recipient, t("outVia"), t("outAnd")))
    .replace("{cli}", notice.cli ?? "");
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

/** Server side: 403 unless the request carries the consent key for this kind and this recipient. */
export function consentDenied(req: Request, kind: OutboundKind, recipient: Recipient): Response | null {
  if (req.headers.get(CONSENT_HEADER) === consentKey(kind, recipient)) return null;
  return Response.json({ error: "consent_required", kind, recipient }, { status: 403 });
}
