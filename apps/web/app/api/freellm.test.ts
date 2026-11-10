import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeFreeLlm } from "../../../../tools/autoloop/e2e/fake-freellm.mjs";
import { POST as ask } from "./buddy/ask/route";
import { GET as recipients } from "./buddy/recipients/route";
import { FREELLM_NAME } from "@/lib/buddy/outbound";

// FreeLLMAPI as an answer source. The router is the user's own, but it passes the content on to a
// provider on the internet, so every route treats it as a send outside this PC: no yes, no request;
// Offline mode refuses it; a failure is said with its reason and never answered by another provider.
// A fake router on 127.0.0.1 stands in for FreeLLMAPI; every other address would fail the test.
const KEY = "fake-unified-key-not-real";
const YES = "ask:freellmapi";
let fake: Awaited<ReturnType<typeof startFakeFreeLlm>>;
let elsewhere: string[];
const realFetch = globalThis.fetch;

beforeAll(async () => { fake = await startFakeFreeLlm({ key: KEY }); });
afterAll(async () => { await fake.close(); });
beforeEach(() => {
  fake.setMode("ok");
  fake.log.length = 0;
  elsewhere = [];
  for (const [k, v] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "", PII_GUARD: "off", BUDDY_PROVIDER: "", BUDDY_CLOUD_MODEL: "", BUDDY_LOCAL_MODEL: "qwen3-vl:2b",
    OPENROUTER_API_KEY: "test-key-not-real", DECISION_PROVIDER: "", GENERATE_PROVIDER: "", SCRIPT_CLOUD: "", OLLAMA_URL: "http://127.0.0.1:9",
    FREELLMAPI_BASE_URL: fake.url, FREELLMAPI_API_KEY: KEY, FREELLMAPI_MODEL: "auto" })) vi.stubEnv(k, v);
  // Only the fake router is reachable: a request to OpenRouter, Ollama or anywhere else is recorded and fails.
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith(fake.url)) return realFetch(url, init);
    elsewhere.push(String(url));
    throw new Error("unreachable in this test");
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const post = (body: unknown, consent?: string) =>
  new Request("http://unit.invalid/api", { method: "POST", body: JSON.stringify(body), headers: consent ? { "x-filow-consent": consent } : {} });
const askBody = { question: "What is on my screen?", provider: "freellm", images: ["data:image/jpeg;base64,YQ=="], screens: [{ index: 1, width: 10, height: 10, cursor: true }] };
const chats = () => fake.log.filter((r) => r.path === "/v1/chat/completions");

describe("OK Filow through FreeLLMAPI: /api/buddy/ask", () => {
  it("names FreeLLMAPI and the provider it chooses as the recipient", async () => {
    expect((await (await recipients()).json()).freellm).toEqual({ id: "freellmapi", names: [FREELLM_NAME] });
  });
  it("without the user's yes for FreeLLMAPI nothing reaches the router", async () => {
    for (const consent of [undefined, "ask:openrouter/google", "script:freellmapi"]) {
      const res = await ask(post(askBody, consent));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "consent_required", kind: "ask", recipient: { id: "freellmapi" } });
    }
    expect(fake.log).toEqual([]);
  });
  it("with the yes the question and the screenshot go to the router, once, and the answer comes back", async () => {
    const res = await ask(post(askBody, YES));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Buddy-Provider")).toBe("freellm");
    expect(await res.text()).toBe("The fake router answered.");
    expect(chats()).toEqual([expect.objectContaining({ keyOk: true, image: true, stream: true, model: "auto" })]);
    expect(elsewhere).toEqual([]);
  });
  it("Offline mode refuses it, with the reason, and does not answer from somewhere else", async () => {
    vi.stubEnv("FILOW_OFFLINE", "1");
    const res = await ask(post(askBody, YES));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "freellm_offline", error: expect.stringMatching(/^\[freellm:offline\] Offline mode is on/) });
    expect(fake.log).toEqual([]);
    expect(elsewhere).toEqual([]);
  });
  it.each([
    ["quota", "quota"],
    ["no_vision", "no_vision"],
    ["broken", "failed"],
  ])("when the router answers %s the user gets that reason, and no other provider is tried", async (mode, code) => {
    fake.setMode(mode);
    const text = await (await ask(post(askBody, YES))).text();
    expect(text).toContain(`[ERROR] [freellm:${code}]`);
    expect(chats()).toHaveLength(1);
    expect(elsewhere).toEqual([]);
  });
  it("a wrong key or a router that is not running is said so", async () => {
    vi.stubEnv("FREELLMAPI_API_KEY", "wrong");
    expect(await (await ask(post(askBody, YES))).text()).toContain("[ERROR] [freellm:bad_key]");
    vi.stubEnv("FREELLMAPI_BASE_URL", "http://127.0.0.1:9/v1");
    expect(await (await ask(post(askBody, YES))).text()).toContain("[ERROR] [freellm:not_running]");
    expect(elsewhere).toEqual(["http://127.0.0.1:9/v1/chat/completions"]);
  });
});
