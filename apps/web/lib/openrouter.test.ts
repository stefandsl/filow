import { afterEach, describe, expect, it, vi } from "vitest";
import { fallbackModels, openRouterChat } from "./openrouter";

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
    expect(calls[0].models).toEqual(["google/gemini-2.5-flash-lite", ...fallbackModels("text")]);
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

  it("honours OPENROUTER_FALLBACK_MODELS, including an empty list", () => {
    process.env.OPENROUTER_FALLBACK_MODELS = "";
    expect(fallbackModels("vision")).toEqual([]);
    process.env.OPENROUTER_FALLBACK_MODELS = "a/b, c/d";
    expect(fallbackModels("text")).toEqual(["a/b", "c/d"]);
    delete process.env.OPENROUTER_FALLBACK_MODELS;
  });
});
