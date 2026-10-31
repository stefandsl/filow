// PII guard: anonymise text before it leaves the machine, restore placeholders in results.
// Two layers: Rizzo-PII (local HTTP sidecar, 22 Italian categories) when reachable,
// plus a regex layer for emails, phones, IBANs, card numbers and Italian codice fiscale.
// ARCHITECTURE.md §6.10. The map lives in memory for one request chain only.
import type { DecideRequest } from "@intelliprompter/core";

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
  { tag: "CARD", re: /\b(?:\d[ -]?){13,19}\b/g, check: (s) => luhn(s.replace(/\D/g, "")) },
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
  return out;
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
  const json = (await res.json()) as RizzoResponse;
  const anonymized = firstString(json, ["anonymized", "anonymized_text", "anonymised", "output", "result", "text"]);
  if (!anonymized) return null;
  const mapping = json.mapping ?? json.map ?? json.dictionary;
  if (mapping && typeof mapping === "object") {
    for (const [k, v] of Object.entries(mapping as Record<string, unknown>)) {
      if (typeof v === "string") map.set(k.startsWith("[") ? k : `[${k}]`, v);
    }
  }
  const entities = json.entities ?? json.spans;
  if (Array.isArray(entities)) {
    for (const e of entities as Array<Record<string, unknown>>) {
      const ph = firstString(e, ["placeholder", "id", "label_id"]);
      const original = firstString(e, ["t", "text", "value"]);
      if (ph && original) map.set(ph.startsWith("[") ? ph : `[${ph}]`, original);
    }
  }
  return anonymized;
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
