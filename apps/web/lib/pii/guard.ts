// PII guard: anonymise text before it leaves the machine, restore placeholders in results.
// Two layers: Rizzo-PII (local HTTP sidecar, 22 Italian categories) when reachable,
// plus a regex layer for emails, phones, IBANs, card numbers and Italian codice fiscale.
// ARCHITECTURE.md §6.10. The map lives in memory for one request chain only.
import type { DecideRequest } from "@filow/core";

export type PiiMap = Map<string, string>; // placeholder -> original value

export type PiiMode = "off" | "on" | "strict";

export function piiMode(): PiiMode {
  const v = (process.env.PII_GUARD || "on").toLowerCase();
  return v === "off" || v === "strict" ? v : "on";
}

export const PII_SERVER_URL = () => (process.env.PII_SERVER_URL || "http://127.0.0.1:5005").replace(/\/$/, "");

// ---- regex layer -------------------------------------------------------------------------
const PATTERNS: Array<{ tag: string; re: RegExp; check?: (s: string) => boolean }> = [
  { tag: "EMAIL", re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { tag: "IBAN", re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g, check: (s) => s.replace(/\s/g, "").length >= 15 },
  { tag: "CODICE_FISCALE", re: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g },
  { tag: "CARD", re: /\b\d(?:[ -]?\d){12,18}\b/g, check: (s) => luhn(s.replace(/\D/g, "")) },
  { tag: "PHONE", re: /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3}[\s.-]?\d{3,4}\b/g, check: (s) => s.replace(/\D/g, "").length >= 9 },
];

function luhn(digits: string): boolean {
  if (digits.length < 13) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Replace matches with [TAG_n] placeholders; the same value always gets the same placeholder. */
export function regexAnonymize(text: string, map: PiiMap): string {
  let out = text;
  for (const { tag, re, check } of PATTERNS) {
    out = out.replace(re, (m) => {
      if (check && !check(m)) return m;
      return placeholderFor(m, tag, map);
    });
  }
  return out;
}

function placeholderFor(value: string, tag: string, map: PiiMap): string {
  for (const [ph, v] of map) if (v === value && ph.startsWith(`[${tag}_`)) return ph;
  let n = 1;
  for (const ph of map.keys()) if (ph.startsWith(`[${tag}_`)) n++;
  const ph = `[${tag}_${n}]`;
  map.set(ph, value);
  return ph;
}

/** Put original values back into text that came from the cloud (answers, facts). */
export function restore(text: string, map: PiiMap): string {
  let out = text;
  for (const [ph, v] of map) out = out.split(ph).join(v);
  // A model does not always copy a placeholder letter for letter: "[fullname_1]", "[FULLNAME 1]",
  // "[ FULLNAME_1 ]" are still that placeholder.
  for (const [ph, v] of map) {
    const m = ph.match(/^\[(.+?)_(\d+)\]$/);
    if (!m) continue;
    const tag = m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[\\s_-]*");
    out = out.replace(new RegExp(`\\[\\s*${tag}[\\s_-]*${m[2]}\\s*\\]`, "gi"), () => v);
  }
  return out;
}

/** "[FULLNAME_1]", "[PERSON_NAME]", "[EMAIL]": capitals in square brackets, the way the guard and the models write a masked value. */
const PLACEHOLDER_SHAPE = /\[\s*[A-Z][A-Z]+(?:[ _-][A-Z]+)*(?:[ _-]?\d+)?\s*\]/g;

/**
 * Placeholders still in `text` after `restore`: a model renamed one ("[FULLNAME_1]" came back as
 * "[PERSON_NAME]"), so its value can not be put back. Brackets the user wrote (they are in `source`,
 * the text before masking) are not placeholders. A caller that finds any must not hand the text on:
 * it takes the source line instead, or fails the item.
 */
export function placeholderLeaks(text: string, source: string): string[] {
  return [...new Set(text.match(PLACEHOLDER_SHAPE) ?? [])].filter((ph) => !source.includes(ph));
}

// ---- Rizzo-PII sidecar ----------------------------------------------------------------------
type RizzoResponse = Record<string, unknown>;

/**
 * POST /analyze on the Rizzo-PII server. The README documents the endpoint and the
 * reversible mapping (placeholders like [FULLNAME_1], per-entity original in `t`);
 * the exact JSON keys are read defensively.
 */
export async function rizzoAnonymize(text: string, map: PiiMap, timeoutMs = 4000): Promise<string | null> {
  if (!text.trim()) return text;
  let res: Response;
  try {
    res = await fetch(`${PII_SERVER_URL()}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, include_mapping: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let json: RizzoResponse;
  try {
    json = (await res.json()) as RizzoResponse;
  } catch {
    return null;
  }
  const anonymized = firstString(json, ["anonymized", "anonymized_text", "anonymised", "output", "result", "text"]);
  if (!anonymized) return null;
  const local: PiiMap = new Map();
  const mapping = json.mapping ?? json.map ?? json.dictionary;
  if (mapping && typeof mapping === "object") {
    for (const [k, v] of Object.entries(mapping as Record<string, unknown>)) {
      if (typeof v === "string") local.set(k.startsWith("[") ? k : `[${k}]`, v);
    }
  }
  const entities = json.entities ?? json.spans;
  if (Array.isArray(entities)) {
    for (const e of entities as Array<Record<string, unknown>>) {
      const ph = firstString(e, ["placeholder", "id", "label_id"]);
      const original = firstString(e, ["t", "text", "value"]);
      if (ph && original) local.set(ph.startsWith("[") ? ph : `[${ph}]`, original);
    }
  }
  let result = anonymized;
  for (const [ph, v] of local) {
    if (map.get(ph) === v) continue;
    const tag = ph.slice(1, ph.lastIndexOf("_")) || ph.slice(1, -1);
    const fresh = map.has(ph) ? placeholderFor(v, tag, map) : (map.set(ph, v), ph);
    if (fresh !== ph) result = result.split(ph).join(fresh);
  }
  return result;
}

function firstString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) if (typeof o[k] === "string" && (o[k] as string).length) return o[k] as string;
  return undefined;
}

export async function rizzoReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${PII_SERVER_URL()}/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
}

// ---- request-level API --------------------------------------------------------------------------
export type GuardResult = { req: DecideRequest; map: PiiMap; layers: Array<"rizzo" | "regex"> };

/**
 * Anonymise every text field of a decide request with one shared map.
 * mode "on": Rizzo when reachable, regex always. mode "strict": Rizzo required, else throw.
 */
export async function anonymizeRequest(req: DecideRequest, mode: PiiMode = piiMode()): Promise<GuardResult> {
  const map: PiiMap = new Map();
  if (mode === "off") return { req, map, layers: [] };
  const layers: Array<"rizzo" | "regex"> = [];
  let useRizzo = await rizzoReachable();
  if (mode === "strict" && !useRizzo) throw new Error(`PII guard is strict but the Rizzo-PII server at ${PII_SERVER_URL()} is not reachable.`);

  const guard = async (s: string): Promise<string> => {
    let out = s;
    if (useRizzo) {
      const r = await rizzoAnonymize(out, map);
      if (r === null) {
        if (mode === "strict") throw new Error("Rizzo-PII request failed in strict mode.");
        useRizzo = false;
      } else out = r;
    }
    return regexAnonymize(out, map);
  };
  const guardAll = async (xs?: string[]) => (xs ? Promise.all(xs.map(guard)) : undefined);

  const out: DecideRequest = {
    ...req,
    transcript: await guard(req.transcript),
    sectionTitle: await guard(req.sectionTitle),
    bullets: await Promise.all(req.bullets.map(async (b) => ({ id: b.id, text: await guard(b.text) }))),
    covered: await guardAll(req.covered),
    upcoming: await guardAll(req.upcoming),
    onScreen: await guardAll(req.onScreen),
  };
  if (useRizzo) layers.push("rizzo");
  layers.push("regex");
  return { req: out, map, layers };
}
