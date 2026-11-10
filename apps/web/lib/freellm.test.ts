import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeFreeLlm } from "../../../tools/autoloop/e2e/fake-freellm.mjs";
import { checkFreeLlm, freellmChat, freellmCodeOf, freellmStream, isLocalHost, localizeFreeLlmError, normalizeBaseUrl, normalizeModel, type FreeLlmCode } from "./freellm";

// FreeLLMAPI is the user's own router; a fake on 127.0.0.1 stands in for it, with its error replies.
// No provider and no network outside this PC.
const KEY = "fake-unified-key-not-real";
let fake: Awaited<ReturnType<typeof startFakeFreeLlm>>;
beforeAll(async () => { fake = await startFakeFreeLlm({ key: KEY }); });
afterAll(async () => { await fake.close(); });
beforeEach(() => {
  fake.setMode("ok");
  fake.log.length = 0;
  for (const [k, v] of Object.entries({ FILOW_OFFLINE: "", FREELLMAPI_BASE_URL: fake.url, FREELLMAPI_API_KEY: KEY, FREELLMAPI_MODEL: "auto:fast" })) vi.stubEnv(k, v);
});
afterEach(() => { vi.unstubAllEnvs(); });

const codeOf = async (p: Promise<unknown>): Promise<FreeLlmCode | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    return freellmCodeOf(e instanceof Error ? e.message : String(e));
  }
};
const chat = () => freellmChat({ messages: [{ role: "user", content: "hi" }] });
const drain = async (g: AsyncGenerator<string>) => { let s = ""; for await (const p of g) s += p; return s; };
const picture = { messages: [{ role: "user", content: [{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,YQ==" } }] }] };

describe("the router address", () => {
  it("is this PC or the user's own network, over http(s), never anywhere on the internet", () => {
    expect(normalizeBaseUrl("http://localhost:3001/v1")).toBe("http://localhost:3001/v1");
    expect(normalizeBaseUrl("http://192.168.1.20:3001")).toBe("http://192.168.1.20:3001/v1");
    expect(normalizeBaseUrl("https://10.0.0.5:3001/v1/")).toBe("https://10.0.0.5:3001/v1");
    expect(normalizeBaseUrl("http://[::1]:3001/v1")).toBe("http://[::1]:3001/v1");
    expect(normalizeBaseUrl("http://router.local:3001/v1")).toBe("http://router.local:3001/v1");
    for (const bad of ["https://api.freellmapi.co/v1", "http://8.8.8.8:3001/v1", "ftp://localhost/v1", "file:///C:/x", "http://user:pw@localhost:3001/v1", "http://localhost:3001/v1?x=1", "http://172.32.0.1/v1", "javascript:alert(1)", "", 42]) {
      expect(normalizeBaseUrl(bad), String(bad)).toBeNull();
    }
    expect(isLocalHost("172.20.3.4")).toBe(true);
    expect(isLocalHost("300.1.1.1")).toBe(false);
  });
  it("the model is auto, an auto:* strategy or one model id", () => {
    expect(normalizeModel("")).toBe("auto");
    expect(normalizeModel("auto:smart")).toBe("auto:smart");
    expect(normalizeModel("gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(normalizeModel("auto smart; rm -rf")).toBeNull();
  });
});

describe("talking to the router", () => {
  it("answers with the unified key and the model or strategy the user chose", async () => {
    const r = await chat();
    expect(r.content).toBe("The fake router answered.");
    expect(r.model).toBe("FreeLLMAPI: fakeprovider/fake-model-1");
    expect(fake.log).toEqual([expect.objectContaining({ path: "/v1/chat/completions", keyOk: true, model: "auto:fast", stream: false })]);
  });
  it("streams an answer", async () => {
    expect(await drain(freellmStream({ messages: [{ role: "user", content: "hi" }] }))).toBe("The fake router answered.");
    expect(fake.log[0]).toEqual(expect.objectContaining({ stream: true }));
  });
  it("each failure has its own code, so the user is told the next step", async () => {
    vi.stubEnv("FREELLMAPI_API_KEY", "wrong-key");
    expect(await codeOf(chat())).toBe("bad_key");
    vi.stubEnv("FREELLMAPI_API_KEY", KEY);
    fake.setMode("quota");
    expect(await codeOf(chat())).toBe("quota");
    expect(await codeOf(drain(freellmStream({ messages: [] })))).toBe("quota");
    fake.setMode("no_vision");
    expect(await codeOf(drain(freellmStream(picture)))).toBe("no_vision");
    fake.setMode("bad_model");
    expect(await codeOf(chat())).toBe("bad_model");
    fake.setMode("broken");
    expect(await codeOf(chat())).toBe("failed");
  });
  it("a router that is not running is said so, with its address", async () => {
    const gone = await startFakeFreeLlm({ key: KEY });
    const url = gone.url;
    await gone.close();
    vi.stubEnv("FREELLMAPI_BASE_URL", url);
    let msg = "";
    try { await chat(); } catch (e) { msg = (e as Error).message; }
    expect(freellmCodeOf(msg)).toBe("not_running");
    expect(msg).toContain(url.replace(/\/v1$/, ""));
  });
  it("nothing is sent offline, without a key or to an address outside the user's network", async () => {
    vi.stubEnv("FILOW_OFFLINE", "1");
    expect(await codeOf(chat())).toBe("offline");
    expect(await codeOf(drain(freellmStream({ messages: [] })))).toBe("offline");
    expect((await checkFreeLlm()).ok).toBe(false);
    vi.stubEnv("FILOW_OFFLINE", "");
    vi.stubEnv("FREELLMAPI_API_KEY", "");
    expect(await codeOf(chat())).toBe("no_key");
    vi.stubEnv("FREELLMAPI_API_KEY", KEY);
    vi.stubEnv("FREELLMAPI_BASE_URL", "https://example.com/v1");
    expect(await codeOf(chat())).toBe("bad_url");
    expect(fake.log).toEqual([]);
  });
});

describe("Check connection", () => {
  it("lists the routing strategies and the models ready now", async () => {
    const r = await checkFreeLlm();
    expect(r).toEqual(expect.objectContaining({ ok: true, url: fake.url }));
    if (r.ok) expect(r.models.slice(0, 5)).toEqual(["auto", "auto:fast", "auto:smart", "gemini-2.5-flash", "llama-3.3-70b"]);
    expect(fake.log).toEqual([expect.objectContaining({ method: "GET", path: "/v1/models", keyOk: true })]);
  });
  it("says what is wrong in the user's language", async () => {
    vi.stubEnv("FREELLMAPI_API_KEY", "wrong");
    const r = await checkFreeLlm("it");
    expect(r).toEqual(expect.objectContaining({ ok: false, code: "bad_key" }));
    if (!r.ok) expect(r.error).toMatch(/^FreeLLMAPI ha rifiutato la chiave/);
  });
});

describe("messages", () => {
  it("a tagged error is shown in Italian with its details, any other text as it is", () => {
    expect(localizeFreeLlmError("[freellm:not_running] FreeLLMAPI is not answering at http://localhost:3001. Start the app.", "it")).toContain("non risponde a http://localhost:3001.");
    expect(localizeFreeLlmError("[freellm:quota] used up", "en")).toBe("used up");
    expect(localizeFreeLlmError("Ollama is not running", "it")).toBe("Ollama is not running");
  });
});
