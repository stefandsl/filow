import { describe, expect, it } from "vitest";
import type { DecisionProviderId } from "@filow/core";
import { pendingWarmup, reloadDecisionModel, warmDecisionModel } from "./useEngine";

describe("reloadDecisionModel (the engine's reload when the decision model left memory)", () => {
  it("loads local Clef again through the warm-up route, with no abort signal", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const post = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response("{}");
    }) as typeof fetch;
    await reloadDecisionModel("clef-local", post);
    expect(calls).toEqual([["/api/local/warmup", { method: "POST" }]]);
  });

  it("has nothing to reload for other providers, and never switches to one", () => {
    let called = 0;
    const post = (async () => (called++, new Response("{}"))) as typeof fetch;
    for (const p of ["openrouter", "clef-cloudflare", "freellm", "matcher"] as DecisionProviderId[]) expect(reloadDecisionModel(p, post)).toBeUndefined();
    expect(called).toBe(0);
  });
});

describe("warmDecisionModel (the take-start warm-up the engine waits for)", () => {
  it("is pending while the warm-up route is loading, gone once it settled, also when it failed", async () => {
    let finish: () => void = () => {};
    const post = (async () => new Promise<Response>((res) => (finish = () => res(new Response("{}"))))) as typeof fetch;
    const p = warmDecisionModel(post);
    expect(pendingWarmup()).toBe(p);
    finish();
    await p;
    await Promise.resolve();
    expect(pendingWarmup()).toBeUndefined();
    const down = (async () => {
      throw new Error("Ollama not reachable");
    }) as typeof fetch;
    await warmDecisionModel(down);
    await Promise.resolve();
    expect(pendingWarmup()).toBeUndefined();
  });
});
