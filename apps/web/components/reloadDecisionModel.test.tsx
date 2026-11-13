import { describe, expect, it } from "vitest";
import type { DecisionProviderId } from "@filow/core";
import { reloadDecisionModel } from "./useEngine";

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
