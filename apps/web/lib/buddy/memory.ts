// "Remember things about me" (docs/okfilow/MEMORY.md): the prompt side. What may be kept, where and for
// how long is decided by the desktop app (apps/desktop/okfilow-memory.js); this file only asks a model
// for candidates and puts the recalled facts into an answer's prompt.
import { CONSENT_HEADER, consentKey, MEMORY_CONSENT_HEADER, type OutboundKind, type Recipient } from "./outbound";

/** A fact kept on this PC: how the user wants answers ("answer") or something about the user ("me"). */
export type MemoryFact = { id: string; kind: "answer" | "me"; text: string; at: string; question: string };
/** What a model proposes after an answer; the desktop app keeps it or not. */
export type ProposedFact = { kind: "answer" | "me"; text: string };

/** At most this many facts go with one question (the desktop app picks them). */
export const MAX_RECALL = 5;

/**
 * The instruction for the model that looks for facts. It reads only the user's own message: never
 * the screen, the answer, a web page or the earlier conversation.
 */
export const LEARN_SYSTEM = [
  "You read one message a user wrote to a screen assistant.",
  "List at most 3 short facts the user stated about themselves, or preferences about how they want answers, that will still be true next week.",
  "Write each on its own line, in the language of the message, at most 15 words, starting with ANSWER: for how to answer, or ME: for something about the user.",
  "Never list: anything about other people, what is on a screen or a web page, passwords, codes, numbers, addresses, or a request that only concerns this one question.",
  "If there is nothing to list, write NONE.",
].join("\n");

/** The lines "ANSWER: ..." and "ME: ..." of the model's reply, at most three. */
export function parseLearned(reply: string): ProposedFact[] {
  const out: ProposedFact[] = [];
  for (const line of String(reply ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:[-*•]\s*)?(ANSWER|ME)\s*[:：]\s*(.+?)\s*$/i.exec(line);
    if (m && m[2] && !/^none\.?$/i.test(m[2])) out.push({ kind: m[1].toUpperCase() === "ANSWER" ? "answer" : "me", text: m[2].replace(/^["“«]|["”»]$/g, "") });
    if (out.length === 3) break;
  }
  return out;
}

/**
 * After an answer: asks POST /api/buddy/memory which facts the question holds, through the route the
 * answer took, and hands them to the desktop app (`keep`), which decides what may be kept. With a
 * recipient (online, or the user's own server) it goes through `sending`, so it refuses without the
 * yes for the saved preferences and shows the going-outside signal; the question's own yes rides along.
 * On this PC nothing leaves. Never throws: a failure only means nothing new is remembered.
 */
export async function learnFacts(o: {
  question: string;
  route: string;
  to: Recipient | null;
  sending: <T>(kind: OutboundKind, recipient: Recipient, run: (headers: Record<string, string>) => Promise<T>) => Promise<T>;
  post: (headers: Record<string, string>, payload: string) => Promise<Response>;
  setup?: string;
  keep: (question: string, facts: ProposedFact[]) => Promise<unknown>;
}): Promise<ProposedFact[]> {
  const ask = async (headers: Record<string, string>) => {
    const res = await o.post(headers, JSON.stringify({ question: o.question, provider: o.route, setup: o.setup }));
    if (!res.ok) return [];
    const data = (await res.json().catch(() => ({}))) as { facts?: unknown };
    return Array.isArray(data.facts) ? parseLearned((data.facts as ProposedFact[]).map((f) => `${f?.kind === "answer" ? "ANSWER" : "ME"}: ${String(f?.text ?? "")}`).join("\n")) : [];
  };
  try {
    const to = o.to;
    const facts = to ? await o.sending("memory", to, (h) => ask({ [MEMORY_CONSENT_HEADER]: h[CONSENT_HEADER], [CONSENT_HEADER]: consentKey("ask", to) })) : await ask({});
    if (facts.length) await o.keep(o.question, facts);
    return facts;
  } catch {
    return [];
  }
}

/** Recalled facts as they arrive in a request: strings only, one line each, at most MAX_RECALL. */
export function sanitizeMemory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.replace(/\s+/g, " ").trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, MAX_RECALL);
}

/** The one short block an answer's system prompt gets; empty when there is nothing to add. */
export function memoryBlock(facts: string[] | undefined): string {
  const list = sanitizeMemory(facts);
  if (!list.length) return "";
  return `\n\nThe user asked you to remember these about them (kept on their PC). Follow the ones about how to answer; use the others only when they fit the question, and do not mention that you remember:\n${list.map((f) => `- ${f}`).join("\n")}`;
}
