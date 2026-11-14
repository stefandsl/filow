// "Remember things about me", the panel's side (lib/buddy/memory.ts): what a model's reply is read as,
// how learning goes out (only with its yes, under the signal), and the consent rules for the new kind.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { LEARN_SYSTEM, learnFacts, memoryBlock, parseLearned, type ProposedFact } from "./memory";
import { createOutboundController, NoConsentError } from "./outboundClient";
import { noticeBody, standing, withConsent, type ConsentMap, type Recipient } from "./outbound";
import { okfText } from "./text";

const OPENAI: Recipient = { id: "openrouter/openai", names: ["OpenRouter", "OpenAI"] };

describe("the model's reply", () => {
  it("keeps the ANSWER and ME lines, at most three, and nothing else", () => {
    expect(parseLearned("Sure!\nANSWER: Answer in short sentences\n- ME: The user teaches physics\nME: NONE\nanswer: Use lists\nME: one too many")).toEqual([
      { kind: "answer", text: "Answer in short sentences" },
      { kind: "me", text: "The user teaches physics" },
      { kind: "answer", text: "Use lists" },
    ]);
    expect(parseLearned("NONE")).toEqual([]);
    expect(parseLearned("The user likes cats")).toEqual([]);
  });
  it("facts are asked in the language of the message, addressed to the user, never \"the user\"", () => {
    expect(LEARN_SYSTEM).toContain("in the language of the message, addressed to the user");
    expect(LEARN_SYSTEM).toContain('Never write "the user".');
    expect(memoryBlock(["Your talk is about solar panels"])).toContain('"you" and "your" mean the user');
  });
  it("the prompt block is empty without facts", () => {
    expect(memoryBlock([])).toBe("");
    expect(memoryBlock(undefined)).toBe("");
  });
});

describe("learning after an answer", () => {
  const reply = (facts: ProposedFact[]) => vi.fn(async (_h: Record<string, string>, _p: string) => Response.json({ facts }));
  const proposed: ProposedFact[] = [{ kind: "answer", text: "Answer in short sentences" }];

  it("on this PC: no consent, no signal, the facts go to the desktop app", async () => {
    const sending = vi.fn();
    const post = reply(proposed);
    const keep = vi.fn(async () => []);
    expect(await learnFacts({ question: "answer in short sentences", route: "local", to: null, sending, post, keep })).toEqual(proposed);
    expect(sending).not.toHaveBeenCalled();
    expect(post.mock.calls[0][0]).toEqual({});
    expect(JSON.parse(post.mock.calls[0][1])).toEqual({ question: "answer in short sentences", provider: "local" });
    expect(keep).toHaveBeenCalledWith("answer in short sentences", proposed);
  });

  it("online without the yes for the saved preferences: nothing is posted and nothing kept", async () => {
    const signal = { begin: vi.fn(), end: vi.fn() };
    let consent: ConsentMap = withConsent({}, "ask", OPENAI, "granted");
    const out = createOutboundController({ consent: () => consent, save: async (next) => { consent = next; return true; }, fetchRecipients: async () => null, signal, onNotice: () => {} });
    const post = reply(proposed);
    const keep = vi.fn(async () => []);
    expect(await learnFacts({ question: "answer in short sentences", route: "cloud", to: OPENAI, sending: out.sending, post, keep })).toEqual([]);
    expect(post).not.toHaveBeenCalled();
    expect(keep).not.toHaveBeenCalled();
    expect(signal.begin).not.toHaveBeenCalled();
    await expect(out.sending("memory", OPENAI, async () => 1)).rejects.toBeInstanceOf(NoConsentError);
  });

  it("online with the yes: both keys travel, the going-outside signal is on while it runs", async () => {
    const signal = { begin: vi.fn(), end: vi.fn() };
    const consent = withConsent(withConsent({}, "ask", OPENAI, "granted"), "memory", OPENAI, "granted");
    const out = createOutboundController({ consent: () => consent, save: async () => true, fetchRecipients: async () => null, signal, onNotice: () => {} });
    const post = reply(proposed);
    const keep = vi.fn(async () => []);
    await learnFacts({ question: "answer in short sentences", route: "cloud", to: OPENAI, sending: out.sending, post, keep });
    expect(post.mock.calls[0][0]).toEqual({ "x-filow-consent": "ask:openrouter/openai", "x-filow-consent-memory": "memory:openrouter/openai" });
    expect(signal.begin).toHaveBeenCalledWith(expect.any(String), "memory", ["OpenRouter", "OpenAI"]);
    expect(signal.end).toHaveBeenCalled();
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it("a failed request only means nothing new is remembered", async () => {
    const keep = vi.fn(async () => []);
    expect(await learnFacts({ question: "q", route: "local", to: null, sending: vi.fn(), post: async () => { throw new Error("down"); }, keep })).toEqual([]);
    expect(await learnFacts({ question: "q", route: "local", to: null, sending: vi.fn(), post: async () => new Response("", { status: 500 }), keep })).toEqual([]);
    expect(keep).not.toHaveBeenCalled();
  });
});

describe("the consent for the saved preferences", () => {
  it("is asked once; a no is remembered silently (questions go without them)", () => {
    expect(standing({}, "memory", OPENAI)).toBe("ask");
    expect(standing(withConsent({}, "memory", OPENAI, "declined"), "memory", OPENAI)).toBe("declined");
    expect(standing(withConsent({}, "memory", OPENAI, "granted"), "memory", OPENAI)).toBe("granted");
    // a yes for the question never covers the saved preferences
    expect(standing(withConsent({}, "ask", OPENAI, "granted"), "memory", OPENAI)).toBe("ask");
  });

  it("the notice says \"your saved preferences\" and names the recipient, in the five languages", () => {
    expect(noticeBody({ kind: "memory", recipient: OPENAI }, okfText("en"))).toMatch(/^Your saved preferences .* go to OpenRouter and then to OpenAI/);
    for (const lang of ["en", "it", "ru", "ro", "ja"]) {
      const t = okfText(lang);
      for (const key of ["notice_memory", "kept_memory", "kind_memory", "memoryOn", "memoryHint", "memoryFrom", "memoryDeleteAll", "memoryDeleteAllConfirm", "memoryDeleteLabel"] as const) {
        expect(t(key), `${lang} ${key}`).not.toContain(String.fromCharCode(0x2014));
        if (lang !== "en") expect(t(key), `${lang} ${key}`).not.toBe(okfText("en")(key));
        expect((t(key).match(/\{\w+\}/g) ?? []).sort().join(), `${lang} ${key}`).toBe((okfText("en")(key).match(/\{\w+\}/g) ?? []).sort().join());
      }
    }
  });

  it("OUTBOUND.md has its row, gated by `memory`, naming \"your saved preferences\"", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const doc = fs.readFileSync(path.join(root, "docs/okfilow/OUTBOUND.md"), "utf8");
    const row = doc.split(/\r?\n/).find((l) => /^\| \d+ \|/.test(l) && l.includes("Remember things about me"));
    expect(row).toBeDefined();
    const cells = row!.split("|");
    expect(cells[3]).toContain("your saved preferences");
    expect(cells[5]).toContain("`memory`");
    expect(cells[6]).toContain("your saved preferences");
  });
});
