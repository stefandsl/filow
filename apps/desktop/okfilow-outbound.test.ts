import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Snapshot = { active: boolean; kinds: string[]; names: string[] };
type State = { begin(id: string, kind: string, names: unknown): boolean; end(id: string, opts?: { cancel?: boolean }): void; clear(prefix?: string): void; snapshot(): Snapshot; active(): boolean };
const { createOutboundState, sanitizeConsent, applyConsentChanges, agentRecipient, agentConsentKey, agentGranted } = require("./okfilow-outbound.js") as {
  createOutboundState(o: Record<string, unknown>): State;
  sanitizeConsent(map: unknown): Record<string, { state: string; at: string; names: string[] }>;
  applyConsentChanges(stored: unknown, changes: unknown): Record<string, { state: string; at: string; names: string[] }>;
  agentRecipient(cli: string | null): { id: string; names: string[]; cli: string } | null;
  agentConsentKey(cli: string | null): string;
  agentGranted(consent: unknown, cli: string | null): boolean;
};

/** A clock and timers the test moves by hand. */
function harness(opts: Record<string, unknown> = {}) {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const seen: Snapshot[] = [];
  const state = createOutboundState({
    onChange: (s: Snapshot) => seen.push(s),
    now: () => t,
    setTimer: (fn: () => void, ms: number) => { timers.set(++seq, { at: t + ms, fn }); return seq; },
    clearTimer: (id: number) => { timers.delete(id); },
    ...opts,
  });
  const advance = (ms: number) => {
    t += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= t) { timers.delete(id); timer.fn(); }
  };
  return { state, seen, advance };
}

describe("going-outside signal", () => {
  it("is off until something is sent, on while it is in flight, and off again after", () => {
    const { state, seen, advance } = harness();
    expect(state.snapshot()).toEqual({ active: false, kinds: [], names: [] });
    state.begin("q1", "ask", ["OpenRouter", "Google"]);
    expect(seen.at(-1)).toEqual({ active: true, kinds: ["ask"], names: ["OpenRouter", "Google"] });
    advance(5000);
    expect(state.active()).toBe(true);
    state.end("q1");
    advance(299);
    expect(state.active()).toBe(true);
    advance(1);
    expect(seen.at(-1)).toEqual({ active: false, kinds: [], names: [] });
    expect(seen).toHaveLength(2);
  });

  it("a request that takes 100 ms is still shown for the minimum time", () => {
    const { state, advance } = harness();
    state.begin("q1", "voice", ["ElevenLabs"]);
    advance(100);
    state.end("q1");
    advance(1099);
    expect(state.active()).toBe(true);
    advance(1);
    expect(state.active()).toBe(false);
  });

  it("stays on until the last of several sends is over, and names every recipient once", () => {
    const { state, seen, advance } = harness();
    state.begin("ask", "ask", ["OpenRouter", "Google"]);
    state.begin("ground", "ask", ["OpenRouter", "Google"]);
    state.begin("tts", "voice", ["ElevenLabs"]);
    expect(seen.at(-1)).toEqual({ active: true, kinds: ["ask", "voice"], names: ["OpenRouter", "Google", "ElevenLabs"] });
    state.end("ask");
    state.end("ground");
    advance(5000);
    expect(seen.at(-1)).toEqual({ active: true, kinds: ["voice"], names: ["ElevenLabs"] });
    state.end("tts");
    advance(5000);
    expect(state.active()).toBe(false);
  });

  it("an answer that turned out to be local cancels at once: nothing went outside", () => {
    const { state, seen } = harness();
    state.begin("q1", "ask", ["OpenRouter", "Google"]);
    state.end("q1", { cancel: true });
    expect(seen.at(-1)).toEqual({ active: false, kinds: [], names: [] });
  });

  it("a stream that begins again before its end timer fires keeps the signal on", () => {
    const { state, advance } = harness();
    state.begin("mic", "audio", ["ElevenLabs"]);
    advance(3000);
    state.end("mic");
    advance(100);
    state.begin("mic", "audio", ["ElevenLabs"]);
    advance(10_000);
    expect(state.active()).toBe(true);
  });

  it("never turns on for a send it cannot name", () => {
    const { state, seen } = harness();
    expect(state.begin("a", "ask", [])).toBe(false);
    expect(state.begin("b", "upload", ["Someone"])).toBe(false);
    expect(state.begin("", "ask", ["OpenRouter"])).toBe(false);
    expect(state.begin("c", "ask", "OpenRouter")).toBe(false);
    expect(seen).toEqual([]);
    state.end("never-began");
    expect(state.active()).toBe(false);
  });

  it("clear drops everything (quit), or only one window's sends", () => {
    const { state, seen } = harness();
    state.begin("agent:1", "agent", ["OpenAI"]);
    state.begin("web:7", "ask", ["OpenRouter", "Google"]);
    state.clear("web:");
    expect(seen.at(-1)).toEqual({ active: true, kinds: ["agent"], names: ["OpenAI"] });
    state.clear();
    expect(seen.at(-1)?.active).toBe(false);
  });
});

describe("stored consent", () => {
  it("keeps well-formed choices and drops everything else", () => {
    const at = "2026-11-10T08:00:00.000Z";
    expect(sanitizeConsent({
      "ask:openrouter/google": { state: "granted", at, names: ["OpenRouter", "Google"] },
      "voice:elevenlabs": { state: "declined", at, names: ["ElevenLabs"] },
      "upload:evil": { state: "granted", at, names: ["X"] },
      "ask:Has Spaces": { state: "granted", at, names: ["X"] },
      "photo:wikipedia": { state: "maybe", at, names: ["Wikipedia"] },
      "agent:openai": "granted",
    })).toEqual({
      "ask:openrouter/google": { state: "granted", at, names: ["OpenRouter", "Google"] },
      "voice:elevenlabs": { state: "declined", at, names: ["ElevenLabs"] },
    });
    expect(sanitizeConsent(null)).toEqual({});
    expect(sanitizeConsent(["ask:openrouter"])).toEqual({});
  });
  it("cuts names to three short strings and caps the list", () => {
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`ask:r${i}`, { state: "granted", at: "x", names: ["A", 7, "B", "C", "D", "<b>" + "n".repeat(90)] }]));
    const out = sanitizeConsent(many);
    expect(Object.keys(out)).toHaveLength(50);
    expect(out["ask:r0"].names).toEqual(["A", "B", "C"]);
    expect(out["ask:r0"].at).toBe(new Date(0).toISOString());
  });
});

describe("consent changes from two windows", () => {
  const at = "2026-11-10T08:00:00.000Z";
  const yes = (names: string[]) => ({ state: "granted", at, names });
  it("merges one window's change into what is stored now, keeping a withdrawal made by the other", () => {
    // Stored now: the panel already withdrew ask; the take page adds audio.
    const stored = { "voice:elevenlabs": yes(["ElevenLabs"]) };
    const next = applyConsentChanges(stored, { "audio:elevenlabs": yes(["ElevenLabs"]) });
    expect(Object.keys(next).sort()).toEqual(["audio:elevenlabs", "voice:elevenlabs"]);
    expect(next["ask:openrouter/google"]).toBeUndefined();
  });
  it("null removes a key; junk keys and entries are ignored", () => {
    const stored = { "ask:openrouter/google": yes(["OpenRouter", "Google"]) };
    expect(applyConsentChanges(stored, { "ask:openrouter/google": null })).toEqual({});
    expect(applyConsentChanges(stored, { "bad key!": yes(["X"]), "ask:x": { state: "maybe" } })).toEqual(stored);
    expect(applyConsentChanges(stored, ["nope"])).toEqual(stored);
  });
});

describe("coding agents", () => {
  it("name who the CLI talks to, and need a yes for exactly that maker", () => {
    expect(agentRecipient("codex")).toMatchObject({ id: "openai", names: ["OpenAI"], cli: "Codex" });
    expect(agentRecipient("claude")).toMatchObject({ id: "anthropic", names: ["Anthropic"], cli: "Claude Code" });
    expect(agentRecipient(null)).toBeNull();
    expect(agentConsentKey("codex")).toBe("agent:openai");
    const consent = { "agent:openai": { state: "granted" }, "agent:anthropic": { state: "declined" } };
    expect(agentGranted(consent, "codex")).toBe(true);
    expect(agentGranted(consent, "claude")).toBe(false);
    expect(agentGranted({}, "codex")).toBe(false);
    expect(agentGranted(undefined, "codex")).toBe(false);
    expect(agentGranted(consent, null)).toBe(false);
  });
});
