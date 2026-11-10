import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as decide } from "./decide/route";
import { POST as vision } from "./vision/route";
import { POST as translate } from "./script/translate/route";
import { POST as generate } from "./script/generate/route";

// The take page, Screen Sense and the script tools send the user's words, screen and slides to a
// cloud model. Each route forwards them only when the request carries the consent key for exactly
// that kind and that recipient. No real keys, no network: fetch is a counter.
const LOCAL = "http://127.0.0.1:";
const ROUTER = "https://openrouter.ai/api/v1/chat/completions";
let net: ReturnType<typeof vi.fn>;
const outside = () => net.mock.calls.map((c) => String(c[0])).filter((url) => !url.startsWith(LOCAL));

const post = (body: unknown, consent?: string) =>
  new Request("http://unit.invalid/api", { method: "POST", body: JSON.stringify(body), headers: consent ? { "x-filow-consent": consent } : {} });
const refusal = (kind: string, id: string, names: string[]) => ({ error: "consent_required", kind, recipient: { id, names } });

const decideBody = { transcript: "and then we look at the numbers", sectionTitle: "Numbers", bullets: [{ id: "a", text: "Revenue grew" }] };
const frame = { image: "data:image/jpeg;base64,YQ==", source: "screen" };
const script = { text: "# Intro\n- Hello everyone", to: "it" };
const deck = { slides: [{ index: 0, title: "Intro", text: "Hello everyone" }] };

beforeEach(() => {
  for (const [key, value] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "", PII_GUARD: "off", DECISION_PROVIDER: "", GENERATE_PROVIDER: "",
    OPENROUTER_API_KEY: "test-key-not-real", OPENROUTER_FALLBACK_MODELS: "", OPENROUTER_DECISION_MODEL: "", CLEF_CLOUDFLARE_MODEL: "",
    OPENROUTER_VISION_MODEL: "", OPENROUTER_GENERATE_MODEL: "", OPENROUTER_GENERATE_VISION_MODEL: "", OLLAMA_URL: "http://127.0.0.1:11434" })) vi.stubEnv(key, value);
  net = vi.fn(async (url: string) => {
    if (String(url) === ROUTER) return Response.json({ choices: [{ message: { content: "{}" } }], usage: { cost: 0 } });
    if (String(url).includes("/api/chat")) return Response.json({ message: { content: '{"title":"Intro","points":["Hello"]}' } });
    return Response.json({});
  });
  vi.stubGlobal("fetch", net);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("spoken words: /api/decide", () => {
  it("without the user's yes the words are not forwarded", async () => {
    const res = await decide(post({ ...decideBody, provider: "openrouter" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(refusal("transcript", "openrouter/google", ["OpenRouter", "Google"]));
    expect(net).not.toHaveBeenCalled();
  });
  it("a yes for another maker or another kind does not count, on OpenRouter or on Cloudflare", async () => {
    vi.stubEnv("OPENROUTER_DECISION_MODEL", "openai/gpt-4o-mini");
    for (const consent of ["transcript:openrouter/google", "ask:openrouter/openai", "audio:openai"]) expect((await decide(post({ ...decideBody, provider: "openrouter" }, consent))).status).toBe(403);
    const cf = await decide(post({ ...decideBody, provider: "clef-cloudflare" }, "transcript:openrouter/openai"));
    expect(await cf.json()).toEqual(refusal("transcript", "cloudflare", ["Cloudflare"]));
    expect(net).not.toHaveBeenCalled();
  });
  it("with the yes for the recipient in use the words go to OpenRouter, once", async () => {
    await decide(post({ ...decideBody, provider: "openrouter" }, "transcript:openrouter/google"));
    expect(outside()).toEqual([ROUTER]);
  });
  it("the decider on this PC needs no consent and sends nothing outside", async () => {
    const res = await decide(post({ ...decideBody, provider: "clef-local" }));
    expect(res.status).not.toBe(403);
    expect(net).toHaveBeenCalled();
    expect(outside()).toEqual([]);
  });
});

describe("pictures of the shared screen: /api/vision", () => {
  it("without the user's yes the picture is not forwarded", async () => {
    const res = await vision(post(frame));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(refusal("screen", "openrouter/google", ["OpenRouter", "Google"]));
    expect(net).not.toHaveBeenCalled();
  });
  it("a yes given for questions, or for another maker, does not cover the screen", async () => {
    vi.stubEnv("OPENROUTER_VISION_MODEL", "openai/gpt-4o-mini");
    for (const consent of ["ask:openrouter/openai", "screen:openrouter/google"]) expect((await vision(post(frame, consent))).status).toBe(403);
    expect(net).not.toHaveBeenCalled();
  });
  it("with the yes the picture goes to OpenRouter, once", async () => {
    await vision(post(frame, "screen:openrouter/google"));
    expect(outside()).toEqual([ROUTER]);
  });
  it("offline the feature is off and nothing is asked or sent", async () => {
    vi.stubEnv("FILOW_OFFLINE", "1");
    const res = await vision(post(frame));
    expect(res.status).toBe(200);
    expect(net).not.toHaveBeenCalled();
  });
});

describe("the script: /api/script/translate and /api/script/generate", () => {
  it("without the user's yes the script is not translated in the cloud", async () => {
    const res = await translate(post(script));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(refusal("script", "openrouter/google", ["OpenRouter", "Google"]));
    expect(net).not.toHaveBeenCalled();
  });
  it("with the yes the script goes to OpenRouter, once", async () => {
    await translate(post(script, "script:openrouter/google"));
    expect(outside()).toEqual([ROUTER]);
  });
  it("without the user's yes no slide is sent to be written up", async () => {
    const res = await generate(post({ ...deck, provider: "openrouter" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(refusal("script", "openrouter/google", ["OpenRouter", "Google"]));
    expect(net).not.toHaveBeenCalled();
  });
  it("the yes must name every maker that will read the slides", async () => {
    vi.stubEnv("OPENROUTER_GENERATE_VISION_MODEL", "anthropic/claude-sonnet-4");
    const res = await generate(post({ ...deck, provider: "openrouter" }, "script:openrouter/google"));
    expect(await res.json()).toEqual(refusal("script", "openrouter/anthropic+google", ["OpenRouter", "Anthropic", "Google"]));
    expect(net).not.toHaveBeenCalled();
  });
  it("with the yes each slide goes to OpenRouter and nowhere else", async () => {
    const res = await generate(post({ ...deck, provider: "openrouter" }, "script:openrouter/google"));
    await res.text();
    expect(outside()).toEqual([ROUTER]);
  });
  it("writing the script with the model on this PC needs no consent and sends nothing outside", async () => {
    const res = await generate(post({ ...deck, provider: "ollama" }));
    expect(res.status).toBe(200);
    await res.text();
    expect(net).toHaveBeenCalled();
    expect(outside()).toEqual([]);
  });
});
