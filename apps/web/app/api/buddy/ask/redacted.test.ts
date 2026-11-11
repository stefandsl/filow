import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as outbound from "@/lib/buddy/outbound";
import * as providers from "@/lib/buddy/providers";
import { OKF_TEXT } from "@/lib/buddy/text";
import { POST as ask } from "./route";

// An account at the cloud provider can hide names in the prompt before any model sees it: the model
// then answers about "[PERSON_NAME]". The answer is streamed as it comes, so the reason follows it.
const shot = { images: ["data:image/jpeg;base64,YQ=="], screens: [{ index: 1, width: 10, height: 10, cursor: true }] };
const request = (body: unknown) => new Request("http://unit.invalid/api/buddy/ask", { method: "POST", body: JSON.stringify(body) });
let answer: string[];
let provider: "cloud" | "local";

beforeEach(() => {
  vi.stubEnv("ACCESS_PASSWORD", "");
  vi.spyOn(providers, "resolveBuddyProvider").mockImplementation(() => provider);
  vi.spyOn(providers, "resolveLocalHelper").mockResolvedValue({ model: "fake", pictures: true } as unknown as providers.LocalHelper);
  vi.spyOn(outbound, "consentDenied").mockReturnValue(null);
  vi.spyOn(providers, "askBuddy").mockImplementation(async function* () {
    for (const piece of answer) yield piece;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("OK Filow says when a service on the way hid a name of the question", () => {
  it("adds the reason after a cloud answer that carries a placeholder the question did not", async () => {
    provider = "cloud";
    answer = ["The [PERSON_", "NAME] cycle is a cycle."];
    const text = await (await ask(request({ question: "What is the Krebs cycle?", ...shot, provider: "cloud", language: "en" }))).text();
    expect(text).toBe(`The [PERSON_NAME] cycle is a cycle.\n\n${OKF_TEXT.en.outRedacted}`);
    const it_ = await (await ask(request({ question: "Che cos'e il ciclo di Krebs?", ...shot, provider: "cloud", language: "it" }))).text();
    expect(it_.endsWith(OKF_TEXT.it.outRedacted)).toBe(true);
  });

  it("adds nothing to an ordinary answer, to brackets the user wrote, to a point on screen, or to a local answer", async () => {
    provider = "cloud";
    answer = ["Press Save. [POINT:120,80:Save:screen1]"];
    expect(await (await ask(request({ question: "How do I save?", ...shot, provider: "cloud" }))).text()).toBe(answer[0]);
    answer = ["[PERSON_NAME] is a tag of the template."];
    expect(await (await ask(request({ question: "what is [PERSON_NAME] here?", ...shot, provider: "cloud" }))).text()).toBe(answer[0]);
    provider = "local";
    expect(await (await ask(request({ question: "What is the Krebs cycle?", ...shot, provider: "local" }))).text()).toBe(answer[0]);
  });
});
