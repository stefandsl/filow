import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createOutboundController } from "@/lib/buddy/outboundClient";
import { noticeBody, type ConsentMap, type NoticeRequest } from "@/lib/buddy/outbound";
import { okfText } from "@/lib/buddy/text";
import * as sysinfo from "@/lib/sysinfo";
import { POST as ask } from "./ask/route";
import { POST as tts } from "./tts/route";
import { GET as photo } from "./photo/route";
import { GET as recipients } from "./recipients/route";
import { POST as elevenToken } from "../stt/elevenlabs-token/route";
import { POST as openaiToken } from "../stt/openai-token/route";

// The second lock: whatever the client does, a route forwards user content to a provider only when
// the request carries the consent key for exactly that kind and that recipient. No real keys, no network.
const LOCAL = "http://127.0.0.1:11434/";
const loopbackFetch = globalThis.fetch;
let net: ReturnType<typeof vi.fn>;
const outside = () => net.mock.calls.map((c) => String(c[0])).filter((url) => !url.startsWith(LOCAL));

const askBody = { question: "What is on my screen?", provider: "cloud", images: ["data:image/jpeg;base64,YQ=="], screens: [{ index: 1, width: 10, height: 10, cursor: true }] };
const post = (body: unknown, consent?: string) =>
  new Request("http://unit.invalid/api", { method: "POST", body: JSON.stringify(body), headers: consent ? { "x-filow-consent": consent } : {} });
const get = (url: string, consent?: string) => new Request(url, { headers: consent ? { "x-filow-consent": consent } : {} });

beforeEach(() => {
  for (const [key, value] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "", BUDDY_PROVIDER: "", BUDDY_CLOUD_MODEL: "", BUDDY_LOCAL_MODEL: "qwen3-vl:2b",
    OPENROUTER_API_KEY: "test-key-not-real", ELEVENLABS_API_KEY: "test-key-not-real", OPENAI_API_KEY: "test-key-not-real",
    OPENROUTER_DECISION_MODEL: "", CLEF_CLOUDFLARE_MODEL: "", OPENROUTER_VISION_MODEL: "", OPENROUTER_GENERATE_MODEL: "", OPENROUTER_GENERATE_VISION_MODEL: "",
    OLLAMA_URL: "http://127.0.0.1:11434" })) vi.stubEnv(key, value);
  net = vi.fn(async (url: string) => {
    if (String(url).includes("openrouter.ai")) return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n');
    if (String(url).includes("/api/chat")) return new Response('{"message":{"content":"Hi"},"done":true}\n');
    if (String(url).includes("text-to-speech")) return new Response("mp3");
    return Response.json({ token: "fake", value: "fake" });
  });
  vi.stubGlobal("fetch", net);
  // a fixed, ordinary PC: a local question must not wait for a real hardware probe
  vi.spyOn(sysinfo, "gpuInfo").mockResolvedValue({ name: "", kind: "none", vramTotalGb: null, vramUsedGb: null, sharedUsedGb: null, utilPct: null, source: "none" });
  vi.spyOn(sysinfo, "machineInfo").mockReturnValue({ ramGb: 32, cores: 8, gpu: { kind: "none", vramGb: null }, freeDiskGb: 500 });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("cloud question: /api/buddy/ask", () => {
  it.each([402, 429, 503])("ends an approved %i response with a plain status and no retry", async status => {
    let count = 0;
    const receiver = createServer((_req, res) => {
      count++;
      res.writeHead(status).end('{"error":"private provider details"}');
    });
    await new Promise<void>((resolve, reject) => receiver.once("error", reject).listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + (receiver.address() as AddressInfo).port;
    vi.stubEnv("OPENROUTER_BASE_URL", base);
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      if (url !== base + "/chat/completions") throw new Error("unexpected destination");
      return loopbackFetch(url, { ...init, redirect: "error" });
    });
    try {
      const result = await ask(post({ ...askBody, question: "Where is Save practice?", sees: false }, "ask:openrouter/openai"));
      expect((await result.text()).trim()).toBe("[ERROR] OpenRouter " + status);
      expect(count).toBe(1);
    } finally {
      receiver.closeAllConnections();
      await new Promise<void>(resolve => receiver.close(() => resolve()));
    }
  });
  it("delivers only disclosed content to the approved router and maker during the sending signal", async () => {
    let reply: ServerResponse | undefined;
    let count = 0, sending = false, activeAtReceipt = false, receivedBody = "", referrer: string | undefined;
    const server = createServer(async (req, res) => {
      count++;
      activeAtReceipt = sending;
      referrer = String(req.headers["http-referer"] || "");
      for await (const chunk of req) receivedBody += chunk;
      reply = res;
    });
    await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    vi.stubEnv("OPENROUTER_BASE_URL", base + "/v1");
    vi.stubEnv("PUBLIC_ORIGIN", "http://192.168.7.21:5021");
    vi.stubEnv("BUDDY_CLOUD_MODEL", "openai/test-model");
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      if (String(url) !== base + "/v1/chat/completions") throw new Error("Unexpected destination");
      return loopbackFetch(url, { ...init, redirect: "error" });
    });
    let stored: ConsentMap = {}, notice: NoticeRequest | null = null;
    const controller = createOutboundController({
      consent: () => stored, save: async next => { stored = next; return true; },
      onNotice: value => { notice = value; },
      fetchRecipients: async () => (await recipients()).json(),
      signal: { begin: () => { sending = true; }, end: () => { sending = false; } },
    });
    try {
      const question = "Where is Save practice?";
      const body = { ...askBody, question, sees: false };
      const who = (await controller.recipients())!.ask;
      expect(who.names).toEqual(["OpenRouter", "OpenAI"]);
      expect((await ask(post(body))).status).toBe(403);
      const decision = controller.allow("ask", who, undefined, true);
      expect(notice).toMatchObject({ words: true, recipient: who });
      const copy = noticeBody(notice!, okfText("en"));
      for (const term of ["OpenRouter", "OpenAI", "question", "No picture"]) expect(copy).toContain(term);
      expect(count).toBe(0);
      await controller.decide("granted");
      expect(await decision).toBe("granted");
      const completed = controller.sending("ask", who, async headers => {
        const res = await ask(new Request("http://unit.invalid/api/buddy/ask", { method: "POST", headers, body: JSON.stringify(body) }));
        return res.text();
      });
      await vi.waitFor(() => expect(reply).toBeDefined());
      reply!.end('data: {"choices":[{"delta":{"content":"Choose Save practice."}}]}\n\ndata: [DONE]\n\n');
      expect(await completed).toBe("Choose Save practice.");
      expect(activeAtReceipt).toBe(true);
      expect(sending).toBe(false);
      expect(count).toBe(1);
      const forwarded = JSON.parse(receivedBody);
      expect(forwarded.model).toBe("openai/test-model");
      expect(forwarded.provider.only.map((host: string) => host.toLowerCase())).toEqual(["openai"]);
      expect(forwarded.messages.at(-1).content).toEqual([{ type: "text", text: expect.stringContaining(question) }]);
      expect(receivedBody).not.toContain(askBody.images[0]);
      expect(referrer, "the presenter did not grant the router their LAN address").not.toContain("192.168.7.21");
    } finally {
      reply?.end();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("without the user's yes nothing is forwarded", async () => {
    const res = await ask(post(askBody));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "consent_required", kind: "ask", recipient: { id: "openrouter/openai", names: ["OpenRouter", "OpenAI"] } });
    expect(net).not.toHaveBeenCalled();
  });
  it("a yes given for another maker, another kind, or in the body does not count", async () => {
    vi.stubEnv("BUDDY_CLOUD_MODEL", "anthropic/claude-haiku-5.5");
    for (const consent of ["ask:openrouter/openai", "voice:elevenlabs", "ask:openrouter"]) expect((await ask(post(askBody, consent))).status).toBe(403);
    expect((await ask(post({ ...askBody, consent: "ask:openrouter/anthropic" }))).status).toBe(403);
    expect(net).not.toHaveBeenCalled();
  });
  it("the default moved from Google to OpenAI: the yes given to Google sends nothing, and the refusal names OpenAI for the notice", async () => {
    const res = await ask(post(askBody, "ask:openrouter/google"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "consent_required", kind: "ask", recipient: { id: "openrouter/openai", names: ["OpenRouter", "OpenAI"] } });
    expect(net).not.toHaveBeenCalled();
  });
  it("with the yes for the recipient in use the question goes to OpenRouter, once, pinned to that maker", async () => {
    const res = await ask(post(askBody, "ask:openrouter/openai"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Buddy-Provider")).toBe("cloud");
    expect(await res.text()).toBe("Hello");
    expect(outside()).toEqual(["https://openrouter.ai/api/v1/chat/completions"]);
    expect(JSON.parse(String(net.mock.calls[0][1].body))).toMatchObject({ model: "openai/gpt-6-luna", provider: { only: ["openai"] }, reasoning: { effort: "minimal" } });
  });
  it("a model the user set is never replaced by the new default", async () => {
    vi.stubEnv("BUDDY_CLOUD_MODEL", "google/gemini-2.5-flash");
    expect((await ask(post(askBody, "ask:openrouter/google"))).status).toBe(200);
    expect(JSON.parse(String(net.mock.calls[0][1].body)).model).toBe("google/gemini-2.5-flash");
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
      expect(await res.json()).toMatchObject({ code: "consent_required", kind: "voice", recipient: { id: "elevenlabs" } });
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
    expect(await res.json()).toMatchObject({ code: "consent_required", kind: "photo", recipient: { id: "wikipedia", names: ["Wikipedia"] } });
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
      ask: { id: "openrouter/openai", names: ["OpenRouter", "OpenAI"] },
      // drawings online have their own models and makers (lib/buddy/drawModels.ts)
      draw: { draw2d: { id: "openrouter/openai", names: ["OpenRouter", "OpenAI"] }, draw3d: { id: "openrouter/google", names: ["OpenRouter", "Google"] } },
      freellm: { id: "freellmapi", names: ["FreeLLMAPI (a free provider it chooses)"] },
      voice: { id: "elevenlabs", names: ["ElevenLabs"] },
      photo: { id: "wikipedia", names: ["Wikipedia"] },
      screen: { id: "openrouter/google", names: ["OpenRouter", "Google"] },
      script: { id: "openrouter/google", names: ["OpenRouter", "Google"] },
      decision: { openrouter: "google/gemini-3.1-flash-lite", cloudflare: "@cf/cloudflare/clef-flash" },
      defaults: { decide: "openrouter", generate: "openrouter" },
    });
    // A script that is written by one maker and read by another names both.
    vi.stubEnv("OPENROUTER_VISION_MODEL", "openai/gpt-4o-mini");
    vi.stubEnv("OPENROUTER_GENERATE_VISION_MODEL", "anthropic/claude-sonnet-4");
    expect(await (await recipients()).json()).toMatchObject({
      screen: { id: "openrouter/openai", names: ["OpenRouter", "OpenAI"] },
      script: { id: "openrouter/anthropic+google", names: ["OpenRouter", "Anthropic", "Google"] },
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
// Version rejection is covered with real HTTP fakes in ollama-runtime.test.ts.
vi.mock("@/../desktop/ollama-runtime", async (original) => ({ ...await original<object>(), checkRuntime: async () => ({ state: "ready" }) }));
