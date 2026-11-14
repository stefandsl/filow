import { beforeEach, describe, expect, it, vi } from "vitest";

// The route with its auth and model call faked: what it hands the model and what `lang` it returns.
const asked: Array<{ language?: string; uiLanguage?: string }> = [];
/** The speed baseline's timing object each model call was given (lib/buddy/timing.ts). */
const timed: unknown[] = [];
vi.mock("@/lib/engineAuth", () => ({ requireEngine: () => null }));
vi.mock("@/lib/buddy/providers", () => ({
  resolveBuddyProvider: () => "local",
  // the setup's screen helper (T2): a local answer that reads the picture
  resolveLocalHelper: async () => ({ model: "fake-vl", pictures: true }),
  askBuddy: async function* (_p: string, req: { language?: string }, _s?: unknown, _h?: unknown, _shape?: unknown, timing?: unknown) { asked.push(req); timed.push(timing); yield "ok"; },
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

  it("carries UI language for app words separately from the model language", async () => {
    const response = await POST(new Request("http://127.0.0.1/api/buddy/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Where is Save?", language: "en", uiLanguage: "it", images: [image], screens: [{index:1,width:10,height:10}] }),
    }));
    await response.text();
    expect(asked[0]).toMatchObject({language:"en",uiLanguage:"it"});
    expect(response.headers.get("X-Buddy-Lang")).toBe("en");
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

describe("/api/buddy/ask speed baseline marks (X-Filow-Run, lib/buddy/timing.ts)", () => {
  const lines: string[] = [];
  const g = globalThis as { __filowPerfLog?: (line: string) => void };
  beforeEach(() => { asked.length = 0; timed.length = 0; lines.length = 0; g.__filowPerfLog = (l) => lines.push(l); });
  const run = (question: string, header?: string) =>
    POST(new Request("http://127.0.0.1/api/buddy/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(header ? { "X-Filow-Run": header } : {}) },
      body: JSON.stringify({ question, images: [image], screens: [{ index: 1, width: 10, height: 10 }] }),
    }));

  it("measures the main answer of a run and writes one line of numbers and fixed names", async () => {
    await (await run("Where is the QUOKKA-4417 Pay now button?", "7")).text();
    expect(timed).toHaveLength(1);
    expect(timed[0]).toMatchObject({ run: "7", images: 1, model: "fake-vl" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^okfilow: server run 7 main: received 0, helperResolved \d+ ms; ; images 1; model fake-vl$/);
    expect(lines.join("\n")).not.toContain("QUOKKA");
  });

  it("labels the grounding request of a run, and measures nothing without a run id", async () => {
    await (await run("Where is the Pay now button?", "7g")).text();
    expect(lines[0]).toMatch(/^okfilow: server run 7g ground: /);
    lines.length = 0;
    timed.length = 0;
    await (await run("Where is the Pay now button?")).text();
    expect(timed).toEqual([null]);
    expect(lines).toEqual([]);
  });

  it("gives no timing to the drawing path (only the main answer calls are measured)", async () => {
    await (await run("draw a picture of a heart", "8")).text();
    expect(timed.length).toBeGreaterThan(0);
    expect(timed.every((t) => t === undefined)).toBe(true);
  });
});
