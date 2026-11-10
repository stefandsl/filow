import { afterEach, describe, expect, it, vi } from "vitest";
import { fallbackModels, openRouterChat, openRouterProvider, routedModels } from "./openrouter";
import { askRecipient, consentKey, noticeBody, routerRecipient } from "./buddy/outbound";
import { askBuddy, buddyCloudRecipient } from "./buddy/providers";
import { OKF_TEXT } from "./buddy/text";

const ok = (model: string) => new Response(JSON.stringify({ model, choices: [{ message: { content: "{}" } }], usage: { cost: 0.001 } }), { status: 200 });

describe("openRouterChat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the model list with fallbacks and retries a 429", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    delete process.env.OPENROUTER_FALLBACK_MODELS;
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return calls.length === 1 ? new Response('{"error":{"code":429}}', { status: 429 }) : ok("google/gemini-2.0-flash-001");
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await openRouterChat("google/gemini-2.5-flash-lite", "text", { messages: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The OpenAI fallback is left out: the user said yes to Google, not to OpenAI.
    expect(fallbackModels("text")).toContain("openai/gpt-4o-mini");
    expect(calls[0].models).toEqual(["google/gemini-2.5-flash-lite", "google/gemini-2.0-flash-001"]);
    expect(r.model).toBe("google/gemini-2.0-flash-001");
    expect(r.cost).toBe(0.001);
  });

  it("does not retry a 400 and reports the body", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    const fetchMock = vi.fn(async () => new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(openRouterChat("m", "text", { messages: [] })).rejects.toThrow("OpenRouter 400: bad request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never sends more than 3 models even with a long fallback list", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OPENROUTER_FALLBACK_MODELS = "m/2,m/3,m/4,m/5";
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return ok("m/2");
    }));
    await openRouterChat("m/1", "text", { messages: [] });
    expect(calls[0].models).toEqual(["m/1", "m/2", "m/3"]);
    delete process.env.OPENROUTER_FALLBACK_MODELS;
  });

  it("never falls back to a model from another maker, whatever the fallback list says", () => {
    process.env.OPENROUTER_FALLBACK_MODELS = "openai/gpt-4o-mini,anthropic/claude-haiku,google/gemini-2.0-flash-001";
    expect(routedModels("google/gemini-2.5-flash", "vision")).toEqual(["google/gemini-2.5-flash", "google/gemini-2.0-flash-001"]);
    expect(routedModels("openai/gpt-4o", "text")).toEqual(["openai/gpt-4o", "openai/gpt-4o-mini"]);
    expect(routedModels("no-maker", "text")).toEqual(["no-maker"]);
    delete process.env.OPENROUTER_FALLBACK_MODELS;
  });

  it("never mixes an open-weight model (run by another company) into a maker-run model's fallbacks", () => {
    process.env.OPENROUTER_FALLBACK_MODELS = "google/gemma-3-27b-it,google/gemini-2.0-flash-001";
    expect(routedModels("google/gemini-2.5-flash", "text")).toEqual(["google/gemini-2.5-flash", "google/gemini-2.0-flash-001"]);
    expect(routedModels("google/gemma-3-12b-it", "text")).toEqual(["google/gemma-3-12b-it", "google/gemma-3-27b-it"]);
    delete process.env.OPENROUTER_FALLBACK_MODELS;
  });

  it("honours OPENROUTER_FALLBACK_MODELS, including an empty list", () => {
    process.env.OPENROUTER_FALLBACK_MODELS = "";
    expect(fallbackModels("vision")).toEqual([]);
    process.env.OPENROUTER_FALLBACK_MODELS = "a/b, c/d";
    expect(fallbackModels("text")).toEqual(["a/b", "c/d"]);
    delete process.env.OPENROUTER_FALLBACK_MODELS;
  });
});

// The notice names the maker as the company that runs the model: the request must make that true.
describe("the host that runs the model is the one the notice names", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_PROVIDER_SORT;
    delete process.env.OPENROUTER_FALLBACK_MODELS;
    delete process.env.BUDDY_CLOUD_MODEL;
  });
  const capture = () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return ok("x");
    }));
    return calls;
  };

  it("pins a Google model to Google's own hosts, and no other company, whatever the payload says", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    const calls = capture();
    await openRouterChat("google/gemini-2.5-flash", "vision", { messages: [], provider: { only: ["deepinfra"], allow_fallbacks: true } });
    expect(calls[0].provider).toEqual({ only: ["google-vertex", "google-ai-studio"], sort: "throughput" });
    expect(askRecipient("google/gemini-2.5-flash")).toEqual({ id: "openrouter/google", names: ["OpenRouter", "Google"] });
  });

  it("pins OpenAI and Anthropic models to their makers; an empty sort leaves only the pin", () => {
    process.env.OPENROUTER_PROVIDER_SORT = "";
    expect(openRouterProvider(["openai/gpt-4o-mini"])).toEqual({ only: ["openai"] });
    expect(openRouterProvider(["anthropic/claude-haiku-4.5"])).toEqual({ only: ["anthropic"] });
  });

  it("does not pin a model its maker does not run; the recipient then says OpenRouter picks the host", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OPENROUTER_FALLBACK_MODELS = "";
    const calls = capture();
    await openRouterChat("meta-llama/llama-3.3-70b-instruct", "text", { messages: [] });
    expect(calls[0].provider).toEqual({ sort: "throughput" });
    for (const model of ["meta-llama/llama-3.3-70b-instruct", "google/gemma-3-27b-it", "openai/gpt-oss-120b", "qwen/qwen3-32b"]) {
      expect(openRouterProvider([model])).not.toHaveProperty("only");
      const r = askRecipient(model);
      expect(r.picked).toBe(true);
      // A yes for a model the maker runs does not cover one a company picked by OpenRouter runs.
      expect(r.id).toMatch(/@any$/);
    }
    // One model the maker does not run is enough: the whole request may go to a picked host.
    expect(openRouterProvider(["google/gemini-2.5-flash", "google/gemma-3-27b-it"])).not.toHaveProperty("only");
    expect(routerRecipient(["google/gemini-2.5-flash", "google/gemma-3-27b-it"]).picked).toBe(true);
    expect(routerRecipient(["google/gemini-2.5-flash", "google/gemini-2.5-flash-lite"]).picked).toBeUndefined();
  });

  it("the notice and the server's refusal say who picks the host when it is not the maker", () => {
    const r = askRecipient("meta-llama/llama-3.3-70b-instruct");
    const body = noticeBody({ kind: "ask", recipient: r }, (k) => OKF_TEXT.en[k]);
    expect(body).toContain("OpenRouter and then to a company OpenRouter picks to run the model made by Meta (it may be a company other than Meta)");
    expect(body).not.toContain("the maker of the model you chose");
    expect(noticeBody({ kind: "ask", recipient: r }, (k) => OKF_TEXT.it[k])).toContain("un'azienda scelta da OpenRouter per far girare il modello prodotto da Meta");
    const pinned = noticeBody({ kind: "ask", recipient: askRecipient("google/gemini-2.5-flash") }, (k) => OKF_TEXT.en[k]);
    expect(pinned).toContain("OpenRouter and then to Google, the maker of the model you chose");
  });

  it("an OK Filow cloud question is pinned the same way (its own request, outside openRouterChat)", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }));
    const consent = consentKey("ask", buddyCloudRecipient());
    for await (const piece of askBuddy("cloud", { question: "q", images: [], screens: [], consent })) void piece;
    expect(calls[0].model).toBe("google/gemini-2.5-flash");
    expect(calls[0].provider).toEqual({ only: ["google-vertex", "google-ai-studio"], sort: "throughput" });
  });
});
