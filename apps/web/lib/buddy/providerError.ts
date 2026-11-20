// A provider's refusal in plain words (owner, 14/11/2026: the bubble showed `ElevenLabs 401:
// {"detail":{"type":"authentication_error",...}}`). Raw provider JSON never reaches the user: a key
// that is not valid, a used-up quota or a payment needed is said in the interface's language, with
// the place to fix it; anything else loses its JSON. The details go to the log file only.

export type ProviderProblem = { provider: string; kind: "key" | "quota" | "payment" };

/** Recovery for a practice question. A refusal never chooses another provider automatically. */
export function practiceFailure(raw: string): "setup" | "quota" | "outage" | null {
  if (/^No OpenRouter key\b/i.test(raw)) return "setup";
  if (/^OpenRouter (402|429)\b/i.test(raw)) return "quota";
  if (/^OpenRouter (5\d\d\b|unavailable\b)/i.test(raw)) return "outage";
  return null;
}

/** The services whose keys Filow holds (the .env file in the app profile). */
const PROVIDERS = ["ElevenLabs", "OpenRouter", "OpenAI", "FreeLLMAPI", "Cloudflare", "Anthropic", "Google"];

/** What went wrong with an online provider, from the text of its error; null when it is something else. */
export function providerProblem(text: string): ProviderProblem | null {
  const s = String(text ?? "");
  const provider = PROVIDERS.find((p) => new RegExp(`(^|[^\\w])${p}(\\s+\\d{3}|:|\\b)`, "i").test(s));
  if (!provider) return null;
  const status = Number(/\b(40[1-3]|429)\b/.exec(s)?.[1] ?? 0);
  if (status === 402 || /payment[_ ]required|insufficient[_ ]credits?|more credits/i.test(s)) return { provider, kind: "payment" };
  if (/quota|insufficient_quota|rate[_ ]limit.*exceeded|credits? (?:exhausted|used up)/i.test(s)) return { provider, kind: "quota" };
  if (status === 401 || status === 403 || /invalid[_ ]api[_ ]key|unauthori[sz]ed|authentication[_ ]error|incorrect api key|no auth credentials/i.test(s)) return { provider, kind: "key" };
  return null;
}

/** Any error as a user may see it: no JSON body, no stack, one line. */
export function plainError(text: string): string {
  return String(text ?? "")
    .replace(/\s*[:-]?\s*[[{][\s\S]*[\]}]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One reporter per window: every error's details go to `log` (the log file), and a provider's refusal
 * is shown once per session in plain words (`show`), however many sentences or answers meet it.
 * Returns the problem, or null when the error is something else.
 */
export function createProblemReporter(o: { log?: (raw: string) => void; show: (text: string, p: ProviderProblem) => void; text: (p: ProviderProblem) => string }) {
  const seen = new Set<string>();
  return (raw: string): ProviderProblem | null => {
    o.log?.(raw);
    const p = providerProblem(raw);
    if (!p) return null;
    const key = `${p.provider}:${p.kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      o.show(o.text(p), p);
    }
    return p;
  };
}

type Words =(key: "providerKey" | "providerQuota" | "providerPayment") => string;
/** The plain sentence for a problem; `where` names the place to fix it (the menu entry for the keys file). */
export function problemText(p: ProviderProblem, t: Words, where: string): string {
  const key = p.kind === "key" ? "providerKey" : p.kind === "quota" ? "providerQuota" : "providerPayment";
  return t(key).split("{provider}").join(p.provider).split("{where}").join(where);
}
