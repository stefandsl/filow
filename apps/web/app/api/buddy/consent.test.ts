import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as ask } from "./ask/route";
import { POST as tts } from "./tts/route";
import { GET as photo } from "./photo/route";
import { GET as recipients } from "./recipients/route";
import { POST as elevenToken } from "../stt/elevenlabs-token/route";
import { POST as openaiToken } from "../stt/openai-token/route";

// The second lock: whatever the client does, a route forwards user content to a provider only when
// the request carries the consent key for exactly that kind and that recipient. No real keys, no network.
const LOCAL = "http://127.0.0.1:11434/";
let net: ReturnType<typeof vi.fn>;
const outside = () => net.mock.calls.map((c) => String(c[0])).filter((url) => !url.startsWith(LOCAL));

const askBody = { question: "What is on my screen?", provider: "cloud", images: ["data:image/jpeg;base64,YQ=="], screens: [{ index: 1, width: 10, height: 10, cursor: true }] };
const post = (body: unknown, consent?: string) =>
  new Request("http://unit.invalid/api", { method: "POST", body: JSON.stringify(body), headers: consent ? { "x-filow-consent": consent } : {} });
const get = (url: string, consent?: string) => new Request(url, { headers: consent ? { "x-filow-consent": consent } : {} });

beforeEach(() => {
  for (const [key, value] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "", BUDDY_PROVIDER: "", BUDDY_CLOUD_MODEL: "", BUDDY_LOCAL_MODEL: "qwen3-vl:2b",
    OPENROUTER_API_KEY: "test-key-not-real", ELEVENLABS_API_KEY: "test-key-not-real", OPENAI_API_KEY: "test-key-not-real",
    OPENROUTER_DECISION_MODEL: "", CLEF_CLOUDFLARE_MODEL: "", OLLAMA_URL: "http://127.0.0.1:11434" })) vi.stubEnv(key, value);
  net = vi.fn(async (url: string) => {
    if (String(url).includes("openrouter.ai")) return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n');
    if (String(url).includes("/api/chat")) return new Response('{"message":{"content":"Hi"},"done":true}\n');
    if (String(url).includes("text-to-speech")) return new Response("mp3");
    return Response.json({ token: "fake", value: "fake" });
  });
  vi.stubGlobal("fetch", net);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("cloud question: /api/buddy/ask", () => {
  it("without the user's yes nothing is forwarded", async () => {
    const res = await ask(post(askBody));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "consent_required", kind: "ask", recipient: { id: "openrouter/google", names: ["OpenRouter", "Google"] } });
    expect(net).not.toHaveBeenCalled();
  });
  it("a yes given for another maker, another kind, or in the body does not count", async () => {
    vi.stubEnv("BUDDY_CLOUD_MODEL", "openai/gpt-4o-mini");
    for (const consent of ["ask:openrouter/google", "voice:elevenlabs", "ask:openrouter"]) expect((await ask(post(askBody, consent))).status).toBe(403);
    expect((await ask(post({ ...askBody, consent: "ask:openrouter/openai" }))).status).toBe(403);
    expect(net).not.toHaveBeenCalled();
  });
  it("with the yes for the recipient in use the question goes to OpenRouter, once", async () => {
    const res = await ask(post(askBody, "ask:openrouter/google"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Buddy-Provider")).toBe("cloud");
    expect(await res.text()).toBe("Hello");
    expect(outside()).toEqual(["https://openrouter.ai/api/v1/chat/completions"]);
  });
  it("a local question needs no consent and never leaves the PC", async () => {
    const res = await ask(post({ ...askBody, provider: "local" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Buddy-Provider")).toBe("local");
    expect(await res.text()).toBe("Hi");
    expect(net).toHaveBeenCalled();
    expect(outside()).toEqual([]);
  });
});

describe("cloud voice: /api/buddy/tts", () => {
  it("without the user's yes the answer text is not sent", async () => {
    for (const consent of [undefined, "ask:openrouter/google", "audio:elevenlabs"]) {
      const res = await tts(post({ text: "The answer." }, consent));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "consent_required", kind: "voice", recipient: { id: "elevenlabs" } });
    }
    expect(net).not.toHaveBeenCalled();
  });
  it("with the yes it goes to ElevenLabs", async () => {
    expect((await tts(post({ text: "The answer." }, "voice:elevenlabs"))).status).toBe(200);
    expect(outside()).toHaveLength(1);
    expect(outside()[0]).toMatch(/^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\//);
  });
});

describe("card photo: /api/buddy/photo", () => {
  it("without the user's yes the subject name is not sent", async () => {
    const res = await photo(get("http://unit.invalid/api/buddy/photo?q=Piston"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "consent_required", kind: "photo", recipient: { id: "wikipedia", names: ["Wikipedia"] } });
    expect(net).not.toHaveBeenCalled();
  });
  it("with the yes it asks Wikipedia", async () => {
    await photo(get("http://unit.invalid/api/buddy/photo?q=Piston", "photo:wikipedia"));
    expect(outside()[0]).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/Piston?redirect=true");
  });
});

describe("cloud speech engines: /api/stt/*-token", () => {
  it("no token is minted without the user's yes for that engine", async () => {
    expect((await elevenToken(post({}))).status).toBe(403);
    expect((await elevenToken(post({}, "audio:openai"))).status).toBe(403);
    expect((await openaiToken(post({}))).status).toBe(403);
    expect((await openaiToken(post({}, "audio:elevenlabs"))).status).toBe(403);
    expect(net).not.toHaveBeenCalled();
  });
  it("with the yes the token is requested from that engine only", async () => {
    expect(await (await elevenToken(post({}, "audio:elevenlabs"))).json()).toEqual({ token: "fake" });
    expect(outside()).toEqual(["https://api.elevenlabs.io/v1/single-use-token/realtime_scribe"]);
    expect(await (await openaiToken(post({}, "audio:openai"))).json()).toEqual({ value: "fake" });
    expect(outside()[1]).toBe("https://api.openai.com/v1/realtime/client_secrets");
  });
});

describe("recipient names: /api/buddy/recipients", () => {
  it("come from the models configured on this PC, and the route sends nothing", async () => {
    expect(await (await recipients()).json()).toEqual({
      offline: false,
      ask: { id: "openrouter/google", names: ["OpenRouter", "Google"] },
      voice: { id: "elevenlabs", names: ["ElevenLabs"] },
      photo: { id: "wikipedia", names: ["Wikipedia"] },
      decision: { openrouter: "google/gemini-2.5-flash-lite", cloudflare: "@cf/cloudflare/clef-flash" },
    });
    vi.stubEnv("BUDDY_CLOUD_MODEL", "anthropic/claude-sonnet-4");
    vi.stubEnv("OPENROUTER_DECISION_MODEL", "openai/gpt-4o-mini");
    expect(await (await recipients()).json()).toMatchObject({
      ask: { id: "openrouter/anthropic", names: ["OpenRouter", "Anthropic"] },
      decision: { openrouter: "openai/gpt-4o-mini" },
    });
    expect(net).not.toHaveBeenCalled();
  });
});
