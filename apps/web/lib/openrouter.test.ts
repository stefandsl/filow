import { afterEach, describe, expect, it, vi } from "vitest";
import { fallbackModels, openRouterChat, routedModels } from "./openrouter";

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

  it("honours OPENROUTER_FALLBACK_MODELS, including an empty list", () => {
    process.env.OPENROUTER_FALLBACK_MODELS = "";
    expect(fallbackModels("vision")).toEqual([]);
    process.env.OPENROUTER_FALLBACK_MODELS = "a/b, c/d";
    expect(fallbackModels("text")).toEqual(["a/b", "c/d"]);
    delete process.env.OPENROUTER_FALLBACK_MODELS;
  });
});
