import { beforeEach, describe, expect, it, vi } from "vitest";

// The route with its auth and model call faked: what it hands the model and what `lang` it returns.
const asked: Array<{ language?: string }> = [];
vi.mock("@/lib/engineAuth", () => ({ requireEngine: () => null }));
vi.mock("@/lib/buddy/providers", () => ({
  resolveBuddyProvider: () => "local",
  // the setup's screen helper (T2): a local answer that reads the picture
  resolveLocalHelper: async () => ({ model: "fake-vl", pictures: true }),
  askBuddy: async function* (_p: string, req: { language?: string }) { asked.push(req); yield "ok"; },
}));

const { POST } = await import("@/app/api/buddy/ask/route");
const image = "data:image/png;base64,iVBORw0KGgo=";
const ask = (question: string, language = "auto", acceptLanguage = "") =>
  POST(new Request("http://127.0.0.1/api/buddy/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(acceptLanguage ? { "Accept-Language": acceptLanguage } : {}) },
    body: JSON.stringify({ question, images: [image], screens: [{ index: 1, width: 10, height: 10 }], language }),
  }));

describe("/api/buddy/ask answers in the question's language and says which", () => {
  beforeEach(() => { asked.length = 0; });

  it("sends lang with the answer and names it to the model", async () => {
    const res = await ask("Где кнопка Export в Adobe Premiere Pro?");
    await res.text();
    expect(res.headers.get("X-Buddy-Lang")).toBe("ru");
    expect(asked[0].language).toBe("ru");
  });

  it("lets the spoken language the user set win", async () => {
    const res = await ask("Where is the save button?", "ja");
    await res.text();
    expect(res.headers.get("X-Buddy-Lang")).toBe("ja");
  });

  it("falls back to the interface language, then English for lang while the model mirrors the question", async () => {
    const it1 = await ask("ok", "auto", "it-IT,it;q=0.9");
    await it1.text();
    expect(it1.headers.get("X-Buddy-Lang")).toBe("it");
    const none = await ask("ok", "auto", "de-DE");
    await none.text();
    expect(none.headers.get("X-Buddy-Lang")).toBe("en");
    expect(asked[1].language).toBe("auto");
  });
});
