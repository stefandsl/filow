// The user's own model servers (his rig, his server): Ollama-compatible addresses he adds by hand.
// Pure: checking an address, saying where it is, and keeping a password out of anything shown or logged.

/** `url` never holds a password; `secret` is "user:password" encrypted with the OS key store (store.ts). */
export type ModelServer = { id: string; name: string; url: string; secret?: string };

export const MAX_SERVERS = 10;
export const MAX_NAME = 40;

/** Why an address is refused, in a word the page turns into a sentence. */
export type BadUrl = "empty" | "invalid" | "scheme";

/**
 * The address as Filow keeps it: http or https, no query or fragment, no trailing slash. A user and
 * password in it (a proxy with basic auth) are kept, and only ever sent to that address.
 */
export function normaliseServerUrl(raw: unknown): { ok: true; url: string } | { ok: false; reason: BadUrl } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, reason: "empty" };
  // "192.168.1.20:11434" or "rig.local": Ollama speaks http unless the user says otherwise
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (!u.hostname) return { ok: false, reason: "invalid" };
  u.search = "";
  u.hash = "";
  return { ok: true, url: u.toString().replace(/\/+$/, "") };
}

/** The address without a user or password: what the page shows and what a log may contain. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.username && !u.password) return url;
    u.username = "";
    u.password = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

const v4 = (host: string) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? host.split(".").map(Number) : null);

/**
 * Where the address is: "this-pc" (loopback), "lan" (a private address, a .local or .lan name, a
 * name without a dot, or a Tailscale-style 100.64/10 address) or "internet" (anything else).
 */
export function whereIs(url: string): "this-pc" | "lan" | "internet" {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return "internet";
  }
  if (host === "localhost" || host === "::1") return "this-pc";
  const ip = v4(host);
  if (ip) {
    const [a, b] = ip;
    if (a === 127) return "this-pc";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return "lan";
    return "internet";
  }
  if (host.includes(":")) return /^(fc|fd|fe8|fe9|fea|feb)/.test(host) ? "lan" : "internet";
  if (!host.includes(".") || /\.(local|lan|home|internal|home\.arpa)$/.test(host)) return "lan";
  return "internet";
}

/** What the page must say about an address before anything goes there. */
export function serverWarnings(url: string): Array<"plain" | "internet"> {
  const out: Array<"plain" | "internet"> = [];
  try {
    if (new URL(url).protocol === "http:" && whereIs(url) !== "this-pc") out.push("plain");
  } catch {
    /* an address that does not parse was refused before */
  }
  if (whereIs(url) === "internet") out.push("internet");
  return out;
}

/** A name for a server: the user's, trimmed and short; else the address's host. */
export function serverName(raw: unknown, url: string): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
  if (name) return name;
  try {
    return new URL(url).hostname;
  } catch {
    return "server";
  }
}
