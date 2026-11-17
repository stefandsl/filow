import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as outbound from "@/lib/buddy/outbound";
import * as providers from "@/lib/buddy/providers";
import { OKF_TEXT } from "@/lib/buddy/text";
import { parseBuddyAnswer } from "@/lib/buddy/prompt";
import { drawingSvg } from "@/lib/buddy/visuals";
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
  it("cleans 3D names before truncation and hides unfinished card tags at every stream boundary", () => {
    const title = "x".repeat(55) + " [PERSON_NAME]";
    const raw = `[CARD:100,100:${title}|Description|]`;
    for (let i = 1; i < raw.length; i++) {
      const parsed = parseBuddyAnswer(raw.slice(0, i), shot.screens, 1, "Ada");
      expect(parsed.cards).toEqual([]);
      expect(parsed.text).toBe("");
    }
    expect(parseBuddyAnswer(raw, shot.screens, 1, "Ada").cards[0].title).toBe("x".repeat(55));
    const model = { title: "[PERSON_NAME]", parts: [{ name: "Body [EMAIL]", shape: "sphere", size: [1] }] };
    const parsed = parseBuddyAnswer('```model3d\n' + JSON.stringify(model) + '\n```', shot.screens, 1, "Ada");
    expect(parsed.model).toMatchObject({ title: "", parts: [{ name: "Body" }] });
    expect(parseBuddyAnswer('[CARD:1,1:[PHONE_NUMBER]|Text|]', shot.screens, 1, "Ada").cards[0].title).toBe("");
  });

  it.each(["en", "it"] as const)("%s cleans only visual titles and labels, keeping the answer and notice", async (language) => {
    provider = "cloud";
    const question = language === "it" ? "Disegna il dinosauro di Ada" : "Draw Ada's dinosaur";
    const drawing = { title: "[PERSON_NAME]", shapes: [
      { type: "circle", cx: 100, cy: 100, r: 20 },
      { type: "text", x: 100, y: 80, text: "Dinosauro ([PERSON_NAME]) - [EMAIL]" },
      { type: "text", x: 100, y: 120, text: "[PHONE_NUMBER]" },
    ] };
    const raw = `The [PERSON_NAME] dinosaur. [CARD:100,100:Dinosauro [PERSON_NAME]|About [PERSON_NAME]|Dinosaur]\n\`\`\`drawing2d\n${JSON.stringify(drawing)}\n\`\`\``;
    answer = [raw.slice(0, 45), raw.slice(45)];
    const text = await (await ask(request({ question, ...shot, provider, language }))).text();
    expect(text).toBe(`${raw}\n\n${OKF_TEXT[language].outRedacted}`);
    const parsed = parseBuddyAnswer(text, shot.screens, 1, question);
    expect(parsed.cards[0]).toMatchObject({ title: "Dinosauro", text: "About [PERSON_NAME]" });
    expect(parsed.text).toContain("The [PERSON_NAME] dinosaur.");
    expect(parsed.text).toContain(OKF_TEXT[language].outRedacted);
    expect(parsed.drawing?.title).toBe("");
    expect(parsed.drawing?.shapes.filter((s) => s.kind === "text")).toMatchObject([{ text: "Dinosauro" }]);
    expect(drawingSvg(parsed.drawing!)).not.toContain("[PERSON_NAME]");
  });

  it.each(["en", "it"] as const)("%s preserves a placeholder typed in the question, including in visuals", async (language) => {
    provider = "cloud";
    const question = language === "it" ? "Disegna [PERSON_NAME]" : "Draw [PERSON_NAME]";
    const raw = '[CARD:100,100:[PERSON_NAME]|Text|]\n```drawing2d\n' + JSON.stringify({ title: "[PERSON_NAME]", shapes: [{ type: "text", x: 100, y: 100, text: "[PERSON_NAME]" }] }) + '\n```';
    answer = [raw];
    const text = await (await ask(request({ question, ...shot, provider, language }))).text();
    expect(text).toBe(raw);
    const parsed = parseBuddyAnswer(text, shot.screens, 1, question);
    expect(parsed.cards[0]?.title).toBe("[PERSON_NAME]");
    expect(parsed.drawing?.title).toBe("[PERSON_NAME]");
    expect(drawingSvg(parsed.drawing!)).toContain("[PERSON_NAME]");
  });

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
