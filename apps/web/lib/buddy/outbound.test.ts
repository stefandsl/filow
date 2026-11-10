import { afterEach, describe, expect, it, vi } from "vitest";
import {
  askRecipient,
  askRoute,
  CONSENT_HEADER,
  consentDenied,
  consentKey,
  createNoticeQueue,
  decisionRecipient,
  gateOutbound,
  isGranted,
  joinNames,
  keepLocalPatch,
  noticeBody,
  OUTBOUND_KINDS,
  photoRecipient,
  standing,
  sttRecipient,
  takeOutbound,
  vendorName,
  voiceRecipient,
  voiceRoute,
  withoutConsent,
  withConsent,
  type ConsentMap,
} from "./outbound";
import { askBuddy, ConsentRequiredError } from "./providers";
import { OKF_TEXT, type OkfKey } from "./text";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("recipient naming comes from the provider and the model in use", () => {
  it("names OpenRouter and the maker of the model", () => {
    expect(askRecipient("google/gemini-2.5-flash")).toEqual({ id: "openrouter/google", names: ["OpenRouter", "Google"] });
    expect(askRecipient("openai/gpt-4o-mini")).toEqual({ id: "openrouter/openai", names: ["OpenRouter", "OpenAI"] });
    expect(askRecipient("anthropic/claude-sonnet-4.5").names).toEqual(["OpenRouter", "Anthropic"]);
    expect(askRecipient("meta-llama/llama-4-vision").names).toEqual(["OpenRouter", "Meta"]);
  });

  it("a maker it has never heard of is still named, from the model id", () => {
    expect(vendorName("acme-labs")).toBe("Acme Labs");
    expect(askRecipient("acme-labs/vision-1")).toEqual({ id: "openrouter/acme-labs", names: ["OpenRouter", "Acme Labs"] });
  });

  it("a model id without a maker names OpenRouter alone, never a guessed company", () => {
    expect(askRecipient("auto")).toEqual({ id: "openrouter", names: ["OpenRouter"] });
    expect(askRecipient("")).toEqual({ id: "openrouter", names: ["OpenRouter"] });
  });

  it("a different maker is a different recipient: the old consent does not cover it", () => {
    const consent = withConsent({}, "ask", askRecipient("google/gemini-2.5-flash"), "granted", "2026-11-09T10:00:00.000Z");
    expect(isGranted(consent, "ask", askRecipient("google/gemini-2.5-pro"))).toBe(true);
    expect(isGranted(consent, "ask", askRecipient("openai/gpt-4o"))).toBe(false);
  });

  it("names the voice, photo, speech and decision recipients", () => {
    expect(voiceRecipient()).toEqual({ id: "elevenlabs", names: ["ElevenLabs"] });
    expect(photoRecipient()).toEqual({ id: "wikipedia", names: ["Wikipedia"] });
    expect(sttRecipient("elevenlabs")).toEqual({ id: "elevenlabs", names: ["ElevenLabs"] });
    expect(sttRecipient("openai")).toEqual({ id: "openai", names: ["OpenAI"] });
    expect(sttRecipient("browser", "Mozilla/5.0 Chrome/140.0 Safari/537.36")).toEqual({ id: "browser/google", names: ["Google"] });
    expect(sttRecipient("browser", "Mozilla/5.0 Chrome/140.0 Safari/537.36 Edg/140.0")).toEqual({ id: "browser/microsoft", names: ["Microsoft"] });
    expect(sttRecipient("browser", "Mozilla/5.0 Version/19.0 Safari/605.1.15")).toEqual({ id: "browser/apple", names: ["Apple"] });
    expect(sttRecipient("sherpa")).toBeNull();
    expect(sttRecipient("whisper")).toBeNull();
    expect(decisionRecipient("openrouter", { openrouter: "google/gemini-2.5-flash-lite", cloudflare: "@cf/cloudflare/clef-flash" })).toEqual({ id: "openrouter/google", names: ["OpenRouter", "Google"] });
    expect(decisionRecipient("clef-cloudflare", { openrouter: "x/y", cloudflare: "@cf/cloudflare/clef-flash" })).toEqual({ id: "cloudflare", names: ["Cloudflare"] });
    expect(decisionRecipient("clef-local", { openrouter: "x/y", cloudflare: "z" })).toBeNull();
  });

  it("joins names for a sentence", () => {
    expect(joinNames(["OpenRouter"], "and")).toBe("OpenRouter");
    expect(joinNames(["OpenRouter", "Google"], "and")).toBe("OpenRouter and Google");
    expect(joinNames(["ElevenLabs", "OpenRouter", "Google"], "e")).toBe("ElevenLabs, OpenRouter e Google");
  });
});

describe("consent is kept per kind and per recipient", () => {
  const google = askRecipient("google/gemini-2.5-flash");

  it("one kind never covers another kind for the same recipient", () => {
    const consent = withConsent({}, "voice", voiceRecipient(), "granted");
    expect(isGranted(consent, "voice", voiceRecipient())).toBe(true);
    expect(isGranted(consent, "audio", sttRecipient("elevenlabs")!)).toBe(false);
  });

  it("declined, missing and broken entries are all not granted", () => {
    expect(isGranted(undefined, "ask", google)).toBe(false);
    expect(isGranted({}, "ask", google)).toBe(false);
    expect(isGranted(withConsent({}, "ask", google, "declined"), "ask", google)).toBe(false);
    expect(isGranted({ [consentKey("ask", google)]: { state: "yes" } } as unknown as ConsentMap, "ask", google)).toBe(false);
    expect(isGranted({ [consentKey("ask", google)]: true } as unknown as ConsentMap, "ask", google)).toBe(false);
  });

  it("withdrawing removes the entry and leaves the others", () => {
    let consent = withConsent({}, "ask", google, "granted");
    consent = withConsent(consent, "voice", voiceRecipient(), "granted");
    const after = withoutConsent(consent, consentKey("ask", google));
    expect(isGranted(after, "ask", google)).toBe(false);
    expect(isGranted(after, "voice", voiceRecipient())).toBe(true);
    expect(isGranted(consent, "ask", google)).toBe(true);
  });
});

describe("gateOutbound: nothing is sent without a yes", () => {
  const google = askRecipient("google/gemini-2.5-flash");

  it("declined: the send function is never called", async () => {
    const send = vi.fn(async () => "sent");
    const ask = vi.fn(async () => "declined" as const);
    const out = await gateOutbound({ kind: "ask", recipient: google, consent: {}, ask, send });
    expect(out).toEqual({ sent: false, decision: "declined" });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("dismissed (closed without choosing): the send function is never called", async () => {
    const send = vi.fn(async () => "sent");
    const out = await gateOutbound({ kind: "ask", recipient: google, consent: {}, ask: async () => "dismissed", send });
    expect(out).toEqual({ sent: false, decision: "dismissed" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a remembered no asks again and still sends nothing until the answer is yes", async () => {
    const send = vi.fn(async () => "sent");
    const ask = vi.fn(async () => "declined" as const);
    await gateOutbound({ kind: "ask", recipient: google, consent: withConsent({}, "ask", google, "declined"), ask, send });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("first time: asks, then sends once after a yes", async () => {
    const order: string[] = [];
    const out = await gateOutbound({
      kind: "ask",
      recipient: google,
      consent: {},
      ask: async () => { order.push("ask"); return "granted"; },
      send: async () => { order.push("send"); return 42; },
    });
    expect(order).toEqual(["ask", "send"]);
    expect(out).toEqual({ sent: true, decision: "granted", value: 42 });
  });

  it("already granted for this recipient: sends without asking", async () => {
    const ask = vi.fn(async () => "declined" as const);
    const out = await gateOutbound({ kind: "ask", recipient: google, consent: withConsent({}, "ask", google, "granted"), ask, send: async () => "ok" });
    expect(ask).not.toHaveBeenCalled();
    expect(out).toEqual({ sent: true, decision: "granted", value: "ok" });
  });

  it("granted for Google does not let a question go to another maker without asking", async () => {
    const ask = vi.fn(async () => "declined" as const);
    const send = vi.fn(async () => "sent");
    await gateOutbound({ kind: "ask", recipient: askRecipient("openai/gpt-4o"), consent: withConsent({}, "ask", google, "granted"), ask, send });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the server refuses a cloud send that carries no consent for the recipient in use", () => {
  const req = { question: "what is this?", images: ["data:image/jpeg;base64,AAAA"], screens: [{ index: 1, width: 10, height: 10 }] };

  it("askBuddy(cloud) without consent throws before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    expect(() => askBuddy("cloud", req)).toThrow(ConsentRequiredError);
    expect(() => askBuddy("cloud", { ...req, consent: "ask:openrouter/openai" })).toThrow(ConsentRequiredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("askBuddy(cloud) with consent for the model in use calls OpenRouter with that model", async () => {
    const fetchMock = vi.fn(async () => new Response("data: [DONE]\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    vi.stubEnv("BUDDY_CLOUD_MODEL", "openai/gpt-4o-mini");
    for await (const _ of askBuddy("cloud", { ...req, consent: "ask:openrouter/openai" })) void _;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(init.body).model).toBe("openai/gpt-4o-mini");
  });

  it("consentDenied answers 403 with the recipient when the header is missing or names someone else", async () => {
    const who = voiceRecipient();
    const none = consentDenied(new Request("http://x/api/buddy/tts", { method: "POST" }), "voice", who);
    expect(none?.status).toBe(403);
    expect(await none?.json()).toEqual({ error: "consent_required", kind: "voice", recipient: who });
    expect(consentDenied(new Request("http://x", { headers: { [CONSENT_HEADER]: "audio:elevenlabs" } }), "voice", who)?.status).toBe(403);
    expect(consentDenied(new Request("http://x", { headers: { [CONSENT_HEADER]: "voice:elevenlabs" } }), "voice", who)).toBeNull();
  });
});

describe("takeOutbound: what a take sends, from the engines picked", () => {
  const models = { openrouter: "google/gemini-2.5-flash-lite", cloudflare: "@cf/cloudflare/clef-flash" };

  it("local engines send nothing", () => {
    expect(takeOutbound({ backend: "sherpa", provider: "clef-local", models })).toEqual([]);
    expect(takeOutbound({ backend: "whisper", provider: "clef-local", models })).toEqual([]);
  });

  it("cloud speech and cloud decisions are two separate items", () => {
    expect(takeOutbound({ backend: "elevenlabs", provider: "openrouter", models })).toEqual([
      { kind: "audio", recipient: { id: "elevenlabs", names: ["ElevenLabs"] } },
      { kind: "transcript", recipient: { id: "openrouter/google", names: ["OpenRouter", "Google"] } },
    ]);
  });

  it("local speech with a cloud decision still sends the words", () => {
    expect(takeOutbound({ backend: "sherpa", provider: "openrouter", models })).toEqual([
      { kind: "transcript", recipient: { id: "openrouter/google", names: ["OpenRouter", "Google"] } },
    ]);
  });
});

describe("askRoute and voiceRoute: the one local-or-cloud decision", () => {
  it("only an explicit cloud choice on an online PC is cloud", () => {
    expect(askRoute({ provider: "cloud" })).toBe("cloud");
    expect(askRoute({ provider: "cloud", offline: false })).toBe("cloud");
    expect(voiceRoute({ voice: "cloud" })).toBe("cloud");
  });

  it("offline mode, a local choice, an unknown value and no status at all are local", () => {
    expect(askRoute({ provider: "cloud", offline: true })).toBe("local");
    expect(askRoute({ provider: "local" })).toBe("local");
    expect(askRoute({ provider: "auto" })).toBe("local");
    expect(askRoute({})).toBe("local");
    expect(askRoute(null)).toBe("local");
    expect(voiceRoute({ voice: "cloud", offline: true })).toBe("local");
    expect(voiceRoute({ voice: "system" })).toBe("local");
    expect(voiceRoute(undefined)).toBe("local");
  });

  it("keeping it on this PC moves the question and the voice to this PC, and nothing else", () => {
    expect(keepLocalPatch("ask")).toEqual({ provider: "local" });
    expect(keepLocalPatch("voice")).toEqual({ voice: "system" });
    expect(keepLocalPatch("photo")).toEqual({});
    expect(keepLocalPatch("agent")).toEqual({});
  });
});

describe("noticeBody: the notice names the recipient actually in use, in both languages", () => {
  const en = (k: OkfKey) => OKF_TEXT.en[k];
  const itText = (k: OkfKey) => OKF_TEXT.it[k];

  it("a cloud question names OpenRouter and the maker of the model chosen", () => {
    expect(noticeBody({ kind: "ask", recipient: askRecipient("google/gemini-2.5-flash") }, en))
      .toBe("Your question and a screenshot of your screens go to OpenRouter and then to Google, the maker of the model you chose.");
    expect(noticeBody({ kind: "ask", recipient: askRecipient("anthropic/claude-sonnet-4") }, en)).toContain("then to Anthropic");
    expect(noticeBody({ kind: "ask", recipient: askRecipient("google/gemini-2.5-flash") }, itText))
      .toBe("La tua domanda e uno screenshot dei tuoi schermi vanno a OpenRouter e poi a Google, che produce il modello che hai scelto.");
  });

  it("every kind has a sentence in both languages and none leaves a placeholder behind", () => {
    for (const kind of OUTBOUND_KINDS) {
      for (const t of [en, itText]) {
        const body = noticeBody({ kind, recipient: { id: "elevenlabs", names: ["ElevenLabs"] }, cli: "Codex" }, t);
        expect(body).toContain("ElevenLabs");
        expect(body).not.toMatch(/[{}]|undefined/);
      }
    }
  });

  it("an agent notice names the CLI the task goes through", () => {
    expect(noticeBody({ kind: "agent", recipient: { id: "openai", names: ["OpenAI"] }, cli: "Codex" }, en))
      .toBe("Your task and the last OK Filow answer go to OpenAI, through Codex on this PC.");
  });
});

describe("standing: what to do before a send", () => {
  const google = askRecipient("google/gemini-2.5-flash");

  it("asks when nothing is stored, and for another maker than the one allowed", () => {
    expect(standing({}, "ask", google)).toBe("ask");
    expect(standing(undefined, "voice", voiceRecipient())).toBe("ask");
    const yes = withConsent({}, "ask", google, "granted");
    expect(standing(yes, "ask", google)).toBe("granted");
    expect(standing(yes, "ask", askRecipient("openai/gpt-4o-mini"))).toBe("ask");
    expect(standing(yes, "voice", voiceRecipient())).toBe("ask");
  });

  it("a stored no never sends: it asks again, except the optional picture which stays off quietly", () => {
    const no = withConsent(withConsent({}, "ask", google, "declined"), "photo", photoRecipient(), "declined");
    expect(standing(no, "ask", google)).toBe("ask");
    expect(standing(no, "photo", photoRecipient())).toBe("declined");
  });
});

describe("notice queue: one notice at a time, one answer per recipient", () => {
  const ask = { kind: "ask" as const, recipient: askRecipient("google/gemini-2.5-flash") };
  const voice = { kind: "voice" as const, recipient: voiceRecipient() };
  const pending = async (p: Promise<unknown>) => (await Promise.race([p, Promise.resolve("pending")])) === "pending";

  it("shows the first notice and answers nothing until the user does", async () => {
    const shown: unknown[] = [];
    const q = createNoticeQueue((head) => shown.push(head));
    const answer = q.ask(ask);
    expect(shown).toEqual([ask]);
    expect(await pending(answer)).toBe(true);
    q.settle("granted");
    expect(await answer).toBe("granted");
    expect(shown).toEqual([ask, null]);
    expect(q.head()).toBeNull();
  });

  it("two sends that need the same yes share one notice and one answer", async () => {
    const shown: unknown[] = [];
    const q = createNoticeQueue((head) => shown.push(head));
    const first = q.ask(ask);
    const second = q.ask({ ...ask });
    expect(second).toBe(first);
    expect(shown).toEqual([ask]);
    q.settle("declined");
    expect(await second).toBe("declined");
  });

  it("the next notice waits its turn and gets its own answer", async () => {
    const shown: unknown[] = [];
    const q = createNoticeQueue((head) => shown.push(head));
    const a = q.ask(ask);
    const v = q.ask(voice);
    expect(shown).toEqual([ask]);
    q.settle("granted");
    expect(shown).toEqual([ask, voice]);
    expect(await a).toBe("granted");
    expect(await pending(v)).toBe(true);
    q.settle("declined");
    expect(await v).toBe("declined");
    expect(shown).toEqual([ask, voice, null]);
  });

  it("dropping the question answers every waiting notice with dismissed, never with a yes", async () => {
    const shown: unknown[] = [];
    const q = createNoticeQueue((head) => shown.push(head));
    const a = q.ask(ask);
    const v = q.ask(voice);
    q.dismissAll();
    expect(await a).toBe("dismissed");
    expect(await v).toBe("dismissed");
    expect(shown).toEqual([ask, null]);
    q.settle("granted");
    q.dismissAll();
    expect(shown).toEqual([ask, null]);
  });
});
