import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as decide } from "./decide/route";
import { consentKey, decisionRecipient } from "@/lib/buddy/outbound";
import { OPENROUTER_DECISION_MODEL } from "@/lib/decide/openrouter";
import { CLEF_CLOUDFLARE_MODEL } from "@/lib/decide/clef";

// Contract: apps/web/app/api/decide/route.ts:55 "the abort is passed on to the model";
// packages/core/src/engine.ts:16 "signal aborts it ... so a slow model does not pile up requests".
const body = { transcript: "we talked about B", sectionTitle: "A", bullets: [{ id: "b", text: "B" }] };
const yes = (provider: "openrouter" | "clef-cloudflare") =>
  consentKey("transcript", decisionRecipient(provider, { openrouter: OPENROUTER_DECISION_MODEL(), cloudflare: CLEF_CLOUDFLARE_MODEL() })!);
const request = (provider: "openrouter" | "clef-cloudflare", signal: AbortSignal) =>
  new Request("http://unit.invalid/api/decide", {
    method: "POST", body: JSON.stringify({ ...body, provider }), signal,
    headers: { "x-filow-consent": yes(provider) },
  });

let upstream: ReturnType<typeof vi.fn>;
let upstreamSignals: Array<AbortSignal | undefined>;
beforeEach(() => {
  for (const [k, v] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "", PII_GUARD: "off", OPENROUTER_API_KEY: "fake",
    OPENROUTER_DECISION_MODEL: "", OPENROUTER_FALLBACK_MODELS: "", CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "fake", CLEF_CLOUDFLARE_MODEL: "" })) vi.stubEnv(k, v);
  upstreamSignals = [];
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** A slow model: answers only when aborted (with an AbortError), like real fetch. */
const slowUpstream = () => vi.fn((_url: string, init?: RequestInit) => {
  upstreamSignals.push(init?.signal ?? undefined);
  return new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
  });
});

describe("/api/decide abort reaches the upstream model request", () => {
  for (const provider of ["openrouter", "clef-cloudflare"] as const) {
    it(`${provider}: aborting the page's request aborts the upstream fetch`, async () => {
      upstream = slowUpstream();
      vi.stubGlobal("fetch", upstream);
      const ctl = new AbortController();
      const pending = decide(request(provider, ctl.signal));
      await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
      ctl.abort(); // the engine's withTimeout gave up
      const upstreamSignal = upstreamSignals[0];
      expect(upstreamSignal, `${provider}: upstream fetch got no signal`).toBeDefined();
      expect(upstreamSignal!.aborted).toBe(true);
      await pending;
    });
  }

  it("openrouter: after an abort a 429 is not retried", async () => {
    vi.useFakeTimers();
    upstream = vi.fn(async () => new Response('{"error":{"code":429}}', { status: 429 }));
    vi.stubGlobal("fetch", upstream);
    const ctl = new AbortController();
    const pending = decide(request("openrouter", ctl.signal));
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
    ctl.abort();
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(upstream, "an abandoned call must start no retry").toHaveBeenCalledTimes(1);
  });
});
