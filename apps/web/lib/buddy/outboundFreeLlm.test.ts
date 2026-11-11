import { describe, expect, it } from "vitest";
import { askRoute, askRouteRecipient, consentKey, decisionRecipient, freellmRecipient, FREELLM_NAME, localNames, noticeBody, signalNames, takeOutbound, type OutboundKind } from "./outbound";
import { OKF_TEXT, type OkfKey } from "./text";

const en = (k: OkfKey) => OKF_TEXT.en[k];
const it_ = (k: OkfKey) => OKF_TEXT.it[k];
const ask = { id: "openrouter/google", names: ["OpenRouter", "Google"] };

describe("FreeLLMAPI as a recipient", () => {
  it("is its own recipient: a yes for OpenRouter never covers it", () => {
    expect(consentKey("ask", freellmRecipient())).toBe("ask:freellmapi");
    expect(askRouteRecipient("freellm", { ask, freellm: freellmRecipient() })).toEqual(freellmRecipient());
    expect(askRouteRecipient("freellm", { ask })).toEqual(freellmRecipient());
    expect(askRouteRecipient("cloud", { ask, freellm: freellmRecipient() })).toEqual(ask);
    expect(askRouteRecipient("local", { ask })).toBeNull();
  });
  it("is chosen only by the user's own pick, and never while offline", () => {
    expect(askRoute({ provider: "freellm" })).toBe("freellm");
    expect(askRoute({ provider: "freellm", offline: true })).toBe("local");
    expect(askRoute({ provider: "cloud" })).toBe("cloud");
    expect(askRoute({ provider: "anything" })).toBe("local");
    expect(askRoute({})).toBe("local");
  });
  it("the signal names FreeLLMAPI and the free provider it chooses, in the window's language", () => {
    expect(signalNames(freellmRecipient())).toEqual([FREELLM_NAME]);
    expect(localNames(signalNames(freellmRecipient()), it_("freeName"))).toEqual(["FreeLLMAPI (un fornitore gratuito scelto dal router)"]);
    expect(localNames(["OpenRouter", "Google"], it_("freeName"))).toEqual(["OpenRouter", "Google"]);
  });
  it("every notice says the content goes on to a provider that may keep or train on it", () => {
    for (const kind of ["ask", "transcript", "script"] as OutboundKind[]) {
      const body = noticeBody({ kind, recipient: freellmRecipient() }, en);
      expect(body).toContain("your FreeLLMAPI router and then to a free AI provider it chooses");
      expect(body).toContain("may keep what it receives or use it to train its models");
      expect(body).not.toMatch(/\{\w+\}/);
      expect(noticeBody({ kind, recipient: freellmRecipient() }, it_)).toContain("può conservare ciò che riceve o usarlo per addestrare");
    }
    expect(noticeBody({ kind: "ask", recipient: ask }, en)).not.toContain("train");
  });
  it("a take that tracks through FreeLLMAPI sends the spoken words to it", () => {
    const models = { openrouter: "google/gemini-2.5-flash-lite", cloudflare: "x" };
    expect(decisionRecipient("freellm", models)).toEqual(freellmRecipient());
    expect(takeOutbound({ backend: "sherpa", provider: "freellm", models })).toEqual([{ kind: "transcript", recipient: freellmRecipient() }]);
  });
});
